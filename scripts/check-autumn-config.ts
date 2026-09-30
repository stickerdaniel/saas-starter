// Importing the config runs atmn()'s first-party linting and wire conversion locally.
// CLI 2's `push --dry-run` contacts Autumn and must not run in static checks.
import '../autumn.config';

if (import.meta.main) console.log('Autumn config validated locally');
