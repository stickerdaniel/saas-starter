# Code page

The second fixture page holds a code fence with a file name and a highlighted line.

## Highlighted lines

```ts title="svelte.config.js" {2} showLineNumbers
const config = {
	kit: { adapter: 'node' }
};
// Markdown inside a fence stays literal: [the guide](../guide.md)
```

## Plain fence

```sh
bun run build
```

Go back to the [guide](../guide.md#install-the-fixture).
