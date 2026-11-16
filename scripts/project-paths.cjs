const path = require('node:path');
const { sourceLayout } = require('./release-inventory.json');

const repositoryRoot = path.resolve(__dirname, '..');
const extensionRoot = path.join(repositoryRoot, 'extension');

// Package names stay stable even when their source moves within the repository.
// Passing an empty layout supports standalone inventory fixtures and flat inputs.
function sourceRelative(relative, layout = sourceLayout) {
  const name = String(relative).replaceAll('\\', '/');
  if (!name || name.includes(':') || path.posix.isAbsolute(name) ||
      name.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error(`INVALID_RELEASE_PATH:${name}`);
  }
  const first = name.split('/')[0];
  for (const [directory, entries] of Object.entries(layout)) {
    if (entries.includes(first)) return `${directory}/${name}`;
  }
  return name;
}

function projectFile(...parts) {
  return path.join(repositoryRoot, sourceRelative(parts.join('/')));
}

module.exports = { repositoryRoot, extensionRoot, sourceRelative, projectFile };
