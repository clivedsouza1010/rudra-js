# rudra-js

A framework of server side components built dynamically and rendered in real time.

rudra-js takes a validated payload describing what a shopper has done, asks a language model to
design a recommendation component for that shopper, and server-renders the result into the initial
HTML response. The model never returns markup: it returns a specification drawn from a closed
vocabulary, which a registry of components renders. That is what makes generated output safe to put
in a page.

It is the reference implementation of the architecture in _AI-Driven Server Side Rendering of Web
Components Using Real-Time Data_.

> **Status: early, and not published.** `@rudra/core` is being built one module at a time and its
> contracts are still moving. Please do not depend on it yet.

## Packages

| Package                          | What it does                                                                                       |
| -------------------------------- | -------------------------------------------------------------------------------------------------- |
| [`@rudra/core`](packages/core)   | The contracts and logic that turn one tracking payload into one renderable component specification |
| [`@rudra/react`](packages/react) | Renders that specification as React Server Components, with no client JavaScript                   |

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

## Getting help

- **Questions and ideas** — open a [discussion](https://github.com/clivedsouza1010/rudra-js/discussions).
- **Bugs** — open an [issue](https://github.com/clivedsouza1010/rudra-js/issues/new/choose).
- **Vulnerabilities** — please report privately, see [SECURITY.md](./SECURITY.md).

## Contributing

Contributions are welcome. [CONTRIBUTING.md](./CONTRIBUTING.md) covers setup, the scope the project
holds to, and its naming and testing conventions. Everyone taking part is expected to follow the
[code of conduct](./CODE_OF_CONDUCT.md).

Changes are recorded in the [changelog](./CHANGELOG.md).

## Licence

[MIT](./LICENSE) © Clive Dsouza
