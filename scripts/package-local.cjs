// Compatibility entry point: local builds must remain unpublished prerelease versions.
process.argv.push('--local');
require('./package-windows.cjs');
