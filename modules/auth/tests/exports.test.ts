import { createExpressAuthAdapter } from "@toolbox/auth/adapters/express"
import { createNextAuthAdapter } from "@toolbox/auth/adapters/next"
import { createNodeTokenGenerator } from "@toolbox/auth/adapters/node/token-generator"
import { createAuth } from "@toolbox/auth/core"
import { getDefaultClock } from "@toolbox/auth/ports"
import { createRegistrationService } from "@toolbox/auth/services"
import { describe, expect, it } from "vitest"

describe("package exports", () => {
  it("exposes supported subpath entry points", () => {
    expect(createAuth).toBeTypeOf("function")
    expect(createExpressAuthAdapter).toBeTypeOf("function")
    expect(createNextAuthAdapter).toBeTypeOf("function")
    expect(createNodeTokenGenerator).toBeTypeOf("function")
    expect(createRegistrationService).toBeTypeOf("function")
    expect(getDefaultClock().now()).toBeInstanceOf(Date)
  })
})
