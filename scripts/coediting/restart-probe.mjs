import { Gateway } from './gateway.mjs'
import { fixtureAuth } from './fixture-auth.mjs'
const auth = fixtureAuth(process.env.PROTOTYPE_SECRET)
const gateway = new Gateway(process.argv[2], auth.verify)
process.stdout.write(JSON.stringify(gateway.snapshot(auth.issue('owner'))))
