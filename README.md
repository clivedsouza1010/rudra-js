# rudra-js

A framework of server side components built dynamically and rendered in real time.

## Packages

| Package                        | What it does                                                                                       |
| ------------------------------ | -------------------------------------------------------------------------------------------------- |
| [`@rudra/core`](packages/core) | The contracts and logic that turn one tracking payload into one renderable component specification |

## Development

Node `^20.19 || >=22.12` is required — TypeScript 7 and Vitest 4 both need it,
and both fail confusingly on older versions. `.nvmrc` pins 22, and
`engine-strict=true` turns a mismatch into a readable install error.

```sh
nvm use
npm install

npm run build        # tsc -b across the workspace
npm run typecheck    # includes test files, which the build does not
npm run lint
npm run format:check
npm test
```

CI runs all five on every pull request.
