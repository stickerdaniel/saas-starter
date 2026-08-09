// The one import here does not exist, which must refuse the whole surface: an
// unresolvable import types as `any` and would silently drop registrations.
import { mutation } from 'not-a-real-package-anywhere';

export const orphan = mutation();
