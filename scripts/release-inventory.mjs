import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const RELEASE_INVENTORY = Object.freeze(JSON.parse(fs.readFileSync(
  new URL('./release-inventory.json', import.meta.url), 'utf8'
)));
const PROFILES = new Set(['full', 'browser', 'store', 'companion']);
const FORBIDDEN_PATH = /(^|\/)(?:\.git|node_modules|tests?|scripts?|output|dist|tmp|qa-artifacts|test-results|browser-profile)(\/|$)|\.(?:zip|crx|pdf|webm|log|map|pdb|pem|key)$|(?:^|\/)\.env(?:\.|$)|\.(?:test|spec)\.[cm]?js$/i;

function safeRelative(value) {
  const name = String(value).replaceAll('\\', '/');
  if (!name || name.includes(':') || path.posix.isAbsolute(name) ||
      name.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error(`INVALID_RELEASE_PATH:${name}`);
  }
  if (FORBIDDEN_PATH.test(name)) throw new Error(`FORBIDDEN_RELEASE_PATH:${name}`);
  return name;
}

export function releaseInventory(rootDir = DEFAULT_ROOT, profile = 'full', spec = RELEASE_INVENTORY) {
  if (!PROFILES.has(profile)) throw new Error('INVALID_RELEASE_PROFILE');
  const root = path.resolve(rootDir);
  if (fs.lstatSync(root).isSymbolicLink()) throw new Error('RELEASE_SOURCE_ROOT_LINK');
  const native = profile === 'full' || profile === 'companion';
  const browser = profile !== 'companion';
  const localDocs = profile === 'full' || profile === 'browser';
  const files = [
    ...(browser ? spec.browserRootFiles : []),
    ...(localDocs ? spec.localDocumentationFiles : []),
    ...(native ? spec.nativeHostFiles : []),
    ...(profile === 'companion' ? (spec.companionDocumentationFiles || []) : [])
  ];
  const directories = [
    ...(browser ? spec.browserDirectories : []),
    ...(localDocs ? spec.localDocumentationDirectories : []),
    ...(native ? spec.nativeHostDirectories : [])
  ];
  const verify = name => {
    const rel = safeRelative(name);
    let file = root;
    for (const segment of rel.split('/')) {
      file = path.join(file, segment);
      if (fs.lstatSync(file).isSymbolicLink()) throw new Error(`RELEASE_SOURCE_LINK:${rel}`);
    }
    return file;
  };
  function walk(directory) {
    const absolute = verify(directory);
    if (!fs.statSync(absolute).isDirectory()) throw new Error(`RELEASE_DIRECTORY_MISSING:${directory}`);
    for (const entry of fs.readdirSync(absolute, {withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
      const rel = `${directory}/${entry.name}`;
      verify(rel);
      if (entry.isDirectory()) walk(rel); else files.push(rel);
    }
  }
  for (const directory of directories) walk(directory);
  return [...new Set(files)].sort().map(source => {
    const absolute = verify(source), stat = fs.statSync(absolute);
    if (!stat.isFile()) throw new Error(`RELEASE_FILE_REQUIRED:${source}`);
    const destination = profile === 'companion' ? source.replace(/^native-host\//, '') : source;
    return {source, path:destination, bytes:stat.size};
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let root = DEFAULT_ROOT, profile = 'full';
  for(let i=2;i<process.argv.length;i++) {
    if(process.argv[i]==='--root' && process.argv[i+1]) root=process.argv[++i];
    else if(process.argv[i]==='--profile' && process.argv[i+1]) profile=process.argv[++i];
    else throw new Error(`UNKNOWN_ARGUMENT:${process.argv[i]}`);
  }
  process.stdout.write(JSON.stringify({profile,files:releaseInventory(root,profile)}));
}
