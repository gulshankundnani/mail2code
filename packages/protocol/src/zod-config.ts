import { z } from "zod";

// zod can compile validators with `new Function` for speed. Extension pages
// forbid that (CSP script-src 'self') and store reviewers flag it, so it is
// switched off: validation uses the interpreted path everywhere.
z.config({ jitless: true });
