				import worker, * as OTHER_EXPORTS from "/home/petter/github/blue-dot/worker/index.ts";
				import * as __MIDDLEWARE_0__ from "/home/petter/github/blue-dot/node_modules/.pnpm/wrangler@4.83.0_@cloudflare+workers-types@4.20260418.1/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts";
import * as __MIDDLEWARE_1__ from "/home/petter/github/blue-dot/node_modules/.pnpm/wrangler@4.83.0_@cloudflare+workers-types@4.20260418.1/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts";

				export * from "/home/petter/github/blue-dot/worker/index.ts";
				const MIDDLEWARE_TEST_INJECT = "__INJECT_FOR_TESTING_WRANGLER_MIDDLEWARE__";
				export const __INTERNAL_WRANGLER_MIDDLEWARE__ = [
					
					__MIDDLEWARE_0__.default,__MIDDLEWARE_1__.default
				]
				export default worker;