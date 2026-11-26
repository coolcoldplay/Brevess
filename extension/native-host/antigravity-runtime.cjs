// Managed copy of Google's CLI; existing terminal installations take precedence.
// Only the official platform manifest selects the artifact.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawn} = require('node:child_process');
const {Readable, Transform} = require('node:stream');
const {pipeline} = require('node:stream/promises');
const fail = (code, message) => Object.assign(new Error(message), {code});
const managedPath = root => path.join(root, 'agent', 'tools', 'antigravity', process.platform === 'win32' ? 'agy.exe' : 'agy');
const channel = 'https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests/';

async function install(root, signal) {
  const destination = managedPath(root);
  if (fs.existsSync(destination)) return;
  const platform = {win32:'windows', darwin:'darwin', linux:'linux'}[process.platform];
  const arch = {arm64:'arm64', x64:'amd64'}[process.arch];
  if (!platform || !arch) throw fail('AGENT_RUNTIME_UNSUPPORTED', '当前系统没有可用的 Antigravity CLI。');
  const musl = platform === 'linux' && !process.report.getReport().header.glibcVersionRuntime ? '_musl' : '';
  const options = {signal, redirect:'error'};
  const manifest = await fetch(channel + platform + '_' + arch + musl + '.json', options);
  if (!manifest.ok) throw fail('AGENT_RUNTIME_DOWNLOAD_FAILED', 'Google 运行组件清单暂时不可用。');
  const {url, sha512} = await manifest.json();
  const source = new URL(url);
  if (source.origin !== 'https://storage.googleapis.com' || source.username || source.password || !source.pathname.startsWith('/antigravity-public/antigravity-cli/') ||
      !/^[a-f0-9]{128}$/i.test(sha512)) throw fail('AGENT_RUNTIME_MANIFEST_INVALID', 'Google 运行组件清单未通过校验。');
  const directory = path.dirname(destination);
  await fs.promises.mkdir(directory, {recursive:true, mode:0o700});
  const stage = await fs.promises.mkdtemp(path.join(directory, '.install-'));
  try {
    const download = await fetch(source, options);
    if (!download.ok) throw fail('AGENT_RUNTIME_DOWNLOAD_FAILED', 'Google 运行组件下载失败。');
    const hash = crypto.createHash('sha512'); let bytes = 0;
    const bounded = new Transform({transform(chunk, _, cb) {
      bytes += chunk.length;
      if (bytes > 650 * 1024 * 1024) return cb(fail('AGENT_RUNTIME_DOWNLOAD_FAILED','运行组件超出大小限制。'));
      hash.update(chunk); cb(null, chunk);
    }});
    const archive = path.join(stage, 'download'), binary = path.join(stage, 'agy');
    await pipeline(Readable.fromWeb(download.body), bounded, fs.createWriteStream(archive, {flags:'wx', mode:0o600}), {signal});
    if (hash.digest('hex') !== sha512.toLowerCase()) throw fail('AGENT_RUNTIME_CHECKSUM_FAILED', '下载校验失败，请重试。');
    if (source.pathname.endsWith('.tar.gz')) {
      const child = spawn('/usr/bin/tar', ['-xzOf', archive, 'antigravity'], {stdio:['ignore','pipe','ignore'], signal});
      const exited = new Promise((resolve,reject) => {child.once('error',reject); child.once('close', code => code === 0 ? resolve() : reject(fail('AGENT_RUNTIME_INSTALL_FAILED','无法解压官方 CLI。')));});
      await Promise.all([exited, pipeline(child.stdout, fs.createWriteStream(binary,{flags:'wx',mode:0o700}), {signal})]);
    } else await fs.promises.rename(archive,binary);
    await fs.promises.chmod(binary,0o700);
    // Concurrent installers can both verify the download; publish only a complete binary.
    try { await fs.promises.link(binary, destination); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  } finally { await fs.promises.rm(stage, {recursive:true, force:true}).catch(()=>{}); }
}

// The authorization code stays in the native port and the CLI's stdin. No file
// or general-purpose command endpoint is used for sign-in.
function login(command, send, signal) {
  const child = spawn(command.cmd, ['acp','--login'], {cwd:os.tmpdir(), stdio:['pipe','pipe','pipe'], windowsHide:true, signal});
  let input = '', offered = false, submitted = false;
  const inspect = chunk => {
    input = (input + chunk.toString()).slice(-32768);
    // A URL may span pipe chunks. Wait for the CLI's line terminator.
    const match = input.match(/https:\/\/accounts\.google\.com\/[^\s<>"\x1b]+(?=[\s\x1b])/);
    if (!offered && match) {
      offered = true;
      send({stage:'authorization',url:match[0]});
    }
  };
  child.stdout.on('data',inspect); child.stderr.on('data',inspect);
  child.stdin.on('error',()=>{});
  const done = new Promise((resolve,reject) => {
    child.once('error',reject);
    child.once('close',code=>code===0 ? resolve() : reject(fail('AGENT_CLIENT_LOGIN_FAILED','Google 登录尚未完成。')));
  });
  return {done, submit(code) {
    if (!offered || submitted || typeof code !== 'string' || !/^[^\s\x00-\x1f]{1,2048}$/.test(code)) throw fail('AGENT_LOGIN_CODE_INVALID','请粘贴 Google 返回的一次性授权码。');
    submitted = true; child.stdin.end(code + '\n');
  }};
}
module.exports = {install, login, managedPath};
