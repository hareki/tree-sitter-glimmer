# `tree-sitter-glimmer`

> A TreeSitter grammar for Glimmer (`.hbs`) templates

[![Verify](https://github.com/ember-tooling/tree-sitter-glimmer/actions/workflows/verify.yml/badge.svg)](https://github.com/ember-tooling/tree-sitter-glimmer/actions/workflows/verify.yml)

## Sample Highlighting

Up-to-date sample highlighting can be found on the web page for this project [here](https://ember-tooling.github.io/tree-sitter-glimmer/).

## Usage

### NeoVim

This package is already available as part of `nvim-treesitter` as the `glimmer` parser.

You can also follow [these instructions](https://github.com/ember-tooling/tree-sitter-glimmer/wiki/Highlighting-in-NeoVim) to allow `nvim-treesitter` to use a locally-cloned version of this parser, which can be useful for development or trying out the most up-to-date highlighting.

## Fork notes

This fork extends upstream beyond Glimmer/Ember component templates so that
classic **full-page Handlebars** files parse too. Upstream targets templates that
are lint-enforced well-formed; these are hand-written pages that are not.

Added on top of upstream:

- Triple mustaches `{{{ ... }}}`, parent-context paths (`../foo`), `<!DOCTYPE>`,
  void elements written with a bare `>`
- Partials (`{{> nav}}`), partial blocks (`{{#> layout}}...{{/layout}}`), and
  raw blocks (`{{{{raw}}}}...{{{{/raw}}}}`)
- Handlebars statements in **attribute position**
  (`<div {{#if x}}data-y="1"{{/if}}>`), not just inside attribute values
- Unquoted attribute values (`<a href=foo.html>`) and mustache attribute names
  (`<div {{attrName}}="x">`)
- `{{else}}` / `{{else if x}}` as real `else_statement` nodes splitting block
  bodies in all three block contexts (declarations, tag bodies, quoted attribute
  values); a `word` token keeps `elsewhere`, `{{#if else}}`, and a top-level
  `{{else}}` parsing as plain identifiers
- Mustaches inside `<script>`/`<style>`: the raw-text scan stops at `{{`, so
  bodies interleave raw fragments with mustache and block nodes, and the
  injection queries use `injection.combined` to stitch the fragments back into
  one JS/CSS document. Handlebars comments (`{{! }}`) directly at raw-body level
  stay unsupported (they are fine inside a block body within the element)
- Zero-argument block helpers (`{{#foo}}...{{/foo}}`)

Known limitations, by choice: `{{^}}`/`{{^foo}}` inverse sections (a `{{^`
token would break `^foo`-style identifiers only inside blocks) and auto-closing
of malformed HTML (see "Finding gaps in bulk" below).

### Error containment

The external scanner must never run its raw-text scans while tree-sitter is
recovering from a syntax error. Tree-sitter marks *every* external token valid
at once during recovery, so an unguarded `raw_text` scan runs far outside any
`<style>`/`<script>` and swallows the rest of the file into a single
unhighlighted token - one unsupported construct on line 13 kills highlighting
through EOF.

`scanner.c` therefore gates both raw scans on `!valid_symbols[COMMENT]`, which is
never set in a genuine raw-text position. This is what keeps an unknown
construct a *local* error instead of a file-wide blackout, and it is locked in by
`test/corpus/error_recovery.txt`. Keep that guard on any raw scanner added later.

### Finding gaps in bulk

Rather than discovering unsupported constructs one file at a time as they are
opened in an editor, scan a whole project:

```sh
npm run test:scan -- --dir ../some-handlebars-app
```

It reports the innermost `ERROR`/`MISSING` node per failing file with source
context, and exits non-zero if any file fails. Note that genuinely malformed HTML
(an unclosed `<div>`) is *expected* to report an error - the grammar deliberately
does not auto-close tags, so those are real template bugs rather than gaps here.

### Release workflow

`nvim-treesitter` installs this parser from the repo's committed `src/`, and does
**not** run `tree-sitter generate` itself. So after changing `grammar.js` or
`src/scanner.c`:

```sh
tree-sitter generate      # rewrites src/parser.c, src/grammar.json, src/node-types.json
npm run test:parser       # corpus + highlight tests
git commit -a && git push # src/ must be committed
```

then `:TSUpdate glimmer` in Neovim to pick up the new HEAD.
