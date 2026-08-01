// Character class shared by `identifier` and the path segments of
// `parent_path` (which must stay a single token, so it cannot reference
// `$.identifier` directly).
const IDENTIFIER_PATTERN = /[^<>"'/={}()\s.,!|~]+/;

// Everything allowed between a tag's name and its `>`/`/>` closer, shared by
// every start-tag-shaped rule.
//
// Handlebars can wrap whole attributes in a block or emit them from a partial
// (`<div {{#if x}}data-y="1"{{/if}}>`), so the tag body admits the same
// statement family as `_hbs_statement` rather than mustaches alone. The block
// forms need their own rules because their bodies hold attributes instead of
// declarations; they are aliased back to the declaration-level node names so
// the query files see one node type per statement kind and cannot drift.
const tagBodyItem = ($) =>
  choice(
    $.attribute_node,
    $.mustache_statement,
    $.partial_statement,
    alias($._attribute_block_statement, $.block_statement),
    alias($._attribute_partial_block_statement, $.partial_block_statement),
    alias($.comment, $.comment_statement),
  );

const tagBody = ($) => repeat(tagBodyItem($));

// Handlebars whitespace control (`~`) is allowed independently on each side of
// a statement, so every `{{`-family opener and the `}}` closer admit a `~`
// variant. `marker` is the statement sigil: `#` for blocks, `>` for partials,
// `#>` for partial blocks, `/` for closers.
const mustacheOpen = (marker = "") => choice("{{" + marker, "{{~" + marker);
const mustacheClose = () => choice("}}", "~}}");

// The renderable content of a mustache or sub-expression: a single value or a
// helper call.
const mustacheContent = ($) => choice($._expression, $.helper_invocation);

// Everything that may follow an attribute's `=`, shared by both of
// `attribute_node`'s name forms.
const attributeValue = ($) =>
  choice(
    $.concat_statement,
    $.number_literal,
    $.mustache_statement,
    $.attribute_value,
  );

// The head shared by `partial_statement` and `partial_block_statement_start`:
// the partial's name (string literal, dynamic sub-expression, or bare name)
// plus any arguments.
const partialHead = ($) =>
  seq(
    field("name", choice($.string_literal, $.sub_expression, $.partial_name)),
    optional($._arguments),
  );

export default grammar({
  name: "glimmer",

  externals: ($) => [$.comment, $.raw_text, $.raw_block_text],

  word: ($) => $.identifier,

  rules: {
    // Entire file
    template: ($) => repeat($._declaration),

    // Each individual "thing" in the file
    _declaration: ($) =>
      choice(
        alias($.comment, $.comment_statement),
        $.doctype,
        $._hbs_statement,
        prec(2, $.style_element),
        prec(2, $.script_element),
        $.element_node,
        prec(-1, $.text_node),
        prec(-2, alias($._loose_brace, $.text_node)),
      ),

    // Any `{{ ... }}` Handlebars statement that renders output: plain/triple
    // mustaches, partials, and the block forms. Membership is defined once
    // here so every context that renders output (declarations, attribute
    // values) allows the same family and cannot drift apart.
    _hbs_statement: ($) =>
      choice(
        $.mustache_statement,
        $.partial_statement,
        $.partial_block_statement,
        $.block_statement,
        $.raw_block_statement,
      ),

    // A `<!DOCTYPE html>` declaration. Full-page Handlebars templates begin
    // with one; Glimmer/Ember component templates never do, so upstream omits
    // it. Matched as a single token so it can never be confused with an HTML
    // comment (`<!-- ... -->`, handled by the external scanner) or a tag.
    doctype: () => token(/<!doctype[^>]*>/i),

    //
    // Text
    //

    // Match anything that doesn't start with
    // - An open/close HTML delimiter (<, >)
    // - An open/close Mustache delimiter ({, })
    text_node: () => token(/[^<>{}]+/),

    // A lone `{` or `}` that isn't part of a `{{ ... }}` delimiter is rendered
    // by Glimmer as literal text (e.g. the trailing `}}` left over when a
    // single-line comment like `{{! ... {{#if}} ... }}` terminates early at the
    // inner `}}`). The low precedence ensures real `{{`/`}}` delimiters, which
    // are longer matches, always win.
    _loose_brace: () => token(prec(-1, /[{}]/)),

    //
    // Primitives
    //

    string_literal: ($) =>
      choice($._single_quote_string_literal, $._double_quote_string_literal),
    // https://github.com/tree-sitter/tree-sitter-javascript/blob/37af80d372ae9e2f5adc2c6321d5a34294dc348b/grammar.js#L826
    _single_quote_string_literal: () => seq("'", /[^'\\]*/, "'"),
    // https://github.com/tree-sitter/tree-sitter-javascript/blob/37af80d372ae9e2f5adc2c6321d5a34294dc348b/grammar.js#L818
    _double_quote_string_literal: () => seq('"', /[^"\\]*/, '"'),

    // Matches the Handlebars NUMBER token: an integer with an optional
    // decimal part (e.g. `12`, `1.5`)
    number_literal: () => /[0-9]+(\.[0-9]+)?/,

    boolean_literal: () => choice("true", "false"),

    //
    // HTML Elements
    //

    // Names of HTML void elements (see `element_node_void`). Defined *before*
    // `tag_name` on purpose: for an exact void name like `meta` both tokens
    // match the same length, and tree-sitter breaks that tie in favor of the
    // rule declared first, so `<meta>` routes to the bare-`>` branch of
    // `element_node_void`. A longer name that merely starts with a void name
    // (`metadata`, `colgroup`) is a strictly longer match for `tag_name`,
    // which wins by longest-match and stays a normal paired element.
    void_tag_name: () =>
      token(/area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr/),

    // Match a sequence of letters, plus
    // - @ (for arguments, so they can only appear first)
    // - Hyphens (for web components)
    // - Period (for contextual Glimmer components)
    // - Colon (for component namespacing and named blocks)
    tag_name: () => /(@?[a-zA-Z0-9]|-|:|\.)+/,

    // "Normal" elements with separate opening and closing tags
    element_node_start: ($) =>
      seq("<", $.tag_name, tagBody($), optional($.block_params), ">"),
    element_node_end: ($) => seq("</", $.tag_name, ">"),

    // "Void" elements are self-closing. HTML void elements (`<meta>`,
    // `<link>`, `<br>`, `<img>`, ...) additionally have no closing tag and are
    // frequently written with a plain `>` rather than `/>`. Glimmer templates
    // never contain these bare `>` void tags, so upstream treats them as
    // "normal" elements and errors waiting for a close tag that never comes.
    // The void name is aliased to `tag_name` so consumers see one node type.
    element_node_void: ($) =>
      choice(
        seq("<", $.tag_name, tagBody($), "/>"),
        seq(
          "<",
          alias($.void_tag_name, $.tag_name),
          tagBody($),
          choice(">", "/>"),
        ),
      ),

    // An "Element" is either a "normal" or "void" element
    element_node: ($) =>
      choice(
        seq($.element_node_start, repeat($._declaration), $.element_node_end),
        $.element_node_void,
      ),

    // Mirror tree-sitter-html's special handling of <style> elements:
    // treat the contents as a single RAW_TEXT token up to the closing tag.
    //
    // NOTE: We only special-case <style> here (not <script>) because that is
    // what the new corpus test asserts.
    style_element: ($) =>
      prec.right(
        2,
        seq(
          optional($._style_element_whitespace),
          alias($.style_start_tag, $.start_tag),
          repeat(
            choice(
              $.raw_text,
              $._hbs_statement,
              prec(-2, alias($._loose_brace, $.text_node)),
            ),
          ),
          alias($.style_end_tag, $.end_tag),
          optional($._style_element_whitespace),
        ),
      ),

    _style_element_whitespace: () => token(/\s+/),


    // These are only used as alias targets so the parse tree matches the
    // upstream HTML grammar's node names.
    start_tag: ($) =>
      seq("<", $.tag_name, tagBody($), optional($.block_params), ">"),

    end_tag: ($) => seq("</", $.tag_name, ">"),

    style_start_tag: ($) =>
      seq(
        "<",
        alias("style", $.tag_name),
        tagBody($),
        optional($.block_params),
        ">",
      ),

  style_end_tag: ($) => seq("</", alias("style", $.tag_name), ">"),

    // Mirror tree-sitter-html's special handling of <script> elements as well,
    // so JS braces don't explode the Glimmer grammar.
    script_element: ($) =>
      prec.right(
        2,
        seq(
          optional($._style_element_whitespace),
          alias($.script_start_tag, $.start_tag),
          repeat(
            choice(
              $.raw_text,
              $._hbs_statement,
              prec(-2, alias($._loose_brace, $.text_node)),
            ),
          ),
          alias($.script_end_tag, $.end_tag),
          optional($._style_element_whitespace),
        ),
      ),

    script_start_tag: ($) =>
      seq(
        "<",
        alias("script", $.tag_name),
        tagBody($),
        optional($.block_params),
        ">",
      ),

    script_end_tag: ($) => seq("</", alias("script", $.tag_name), ">"),

    attribute_name: () => /[^<>"'/={}()\s\.,!?|]+/,

    _splattributes: () => "...attributes",

    attribute_node: ($) =>
      choice(
        seq($.attribute_name, optional(seq("=", attributeValue($)))),
        // A mustache can also *be* the attribute's name, e.g.
        // `<div {{attrName}}="x">`. The `=` is required on this branch: without
        // it the mustache is a plain tag-body statement (a Glimmer modifier),
        // which `tagBody` already handles, so the two never overlap.
        seq(field("name", $.mustache_statement), "=", attributeValue($)),
        alias($._splattributes, $.attribute_name),
      ),

    // An unquoted attribute value, e.g. `<a href=foo.html>`. Plain HTML that
    // Glimmer templates never use, so upstream omits it. `{`/`}` are excluded so
    // a following `{{ ... }}` is never swallowed, and the negative token
    // precedence lets `number_literal` win the tie on `attr=12`.
    //
    // The shape `(\/*[^...\/]+)+` allows leading and interior slashes
    // (`href=/a/b`, `src=//host/x`) but never a trailing one, so the `/` in
    // `<Foo bar=baz/>` stays available to close the tag. HTML would read that
    // slash as part of the value; self-closing tags are far more common than
    // trailing-slash unquoted values in these templates.
    attribute_value: () => token(prec(-1, /(\/*[^<>"'=\s{}/]+)+/)),

    // Special attribute-value strings that can embed a mustache statement
    concat_statement: ($) =>
      choice(
        $._single_quote_concat_statement,
        $._double_quote_concat_statement,
      ),

    // Attribute values commonly embed not just `{{ ... }}` but whole
    // `{{#if}}...{{/if}}` / `{{#each}}...{{/each}}` blocks (e.g.
    // `class="a {{#if x}}b{{/if}}"`) and partials, so the full statement
    // family is allowed here.
    _single_quote_concat_statement: ($) =>
      seq(
        "'",
        repeat(
          choice(
            $._mustache_safe_single_quote_string_literal_content,
            $._hbs_statement,
          ),
        ),
        "'",
      ),
    _double_quote_concat_statement: ($) =>
      seq(
        '"',
        repeat(
          choice(
            $._mustache_safe_double_quote_string_literal_content,
            $._hbs_statement,
          ),
        ),
        '"',
      ),

    _mustache_safe_string_literal: ($) =>
      choice(
        $._mustache_safe_single_quote_string_literal,
        $._mustache_safe_double_quote_string_literal,
      ),
    _mustache_safe_single_quote_string_literal_content: () => /[^'\\{]+/,
    _mustache_safe_single_quote_string_literal: ($) =>
      seq("'", $._mustache_safe_single_quote_string_literal_content, "'"),
    _mustache_safe_double_quote_string_literal_content: () => /[^"\\{]+/,
    _mustache_safe_double_quote_string_literal: ($) =>
      seq('"', $._mustache_safe_double_quote_string_literal_content, '"'),

    block_params: ($) => seq("as", "|", repeat($.identifier), "|"),

    identifier: () => IDENTIFIER_PATTERN,
    path_expression: ($) => seq($.identifier, repeat1(seq(".", $.identifier))),

    // Handlebars parent-context references: `..` (the parent scope itself),
    // `../foo`, `../../foo.bar`. These use `/` as a segment separator, which
    // the plain `identifier` regex forbids, so upstream (which never needs
    // them) parses them into an ERROR. Kept a single token to avoid clashing
    // with the `/` in `</` and `/>` tag delimiters.
    parent_path: () =>
      token(
        seq(
          "..",
          repeat(seq("/", "..")),
          optional(
            seq("/", IDENTIFIER_PATTERN, repeat(seq(".", IDENTIFIER_PATTERN))),
          ),
        ),
      ),

    // Represents anything that can be a "value"; things like
    // - Strings
    // - Numbers
    // - Variables
    // - Handlebars sub-expressions
    _expression: ($) =>
      choice(
        prec(1, $.number_literal),
        $.string_literal,
        $.boolean_literal,
        $.sub_expression,
        $.parent_path,
        $.path_expression,
        $.identifier,
      ),

    hash_pair: ($) =>
      seq(field("key", $.identifier), "=", field("value", $._expression)),

    // `{{{ ... }}}` is Handlebars' unescaped (raw HTML) output; `{{ ... }}` is
    // the escaped form. Both share this node so every existing highlight query
    // applies to the triple form too.
    mustache_statement: ($) =>
      choice(
        seq(mustacheOpen(), mustacheContent($), mustacheClose()),
        seq("{{{", mustacheContent($), "}}}"),
      ),

    // Handlebars partial invocation, e.g. `{{> nav}}`, `{{> nav foo}}`,
    // `{{> nav key=value}}` or `{{> partials/header}}`. This is standard
    // Handlebars syntax that plain Glimmer/Ember templates omit; supporting it
    // keeps `.hbs` files that use partials from parsing into an ERROR node.
    partial_statement: ($) =>
      seq(mustacheOpen(">"), partialHead($), mustacheClose()),

    // A partial name is broader than an `identifier`: Handlebars allows dotted
    // and slash-separated names (`foo.bar`, `partials/header`) as well as the
    // `@partial-block` reference.
    partial_name: () => token(/[A-Za-z0-9_@][A-Za-z0-9_@:./-]*/),

    // Handlebars partial block, e.g. `{{#> layout key=value}} ... {{/layout}}`.
    // The body renders wherever the partial emits `{{> @partial-block}}`. Like
    // `partial_statement`, this is standard Handlebars that Glimmer omits.
    // The end rule mirrors `block_statement_end` but takes a `partial_name`,
    // since the closer must repeat the (possibly dotted/slashed) partial name.
    partial_block_statement_start: ($) =>
      seq(mustacheOpen("#>"), partialHead($), mustacheClose()),

    partial_block_statement_end: ($) =>
      seq(mustacheOpen("/"), field("name", $.partial_name), mustacheClose()),

    partial_block_statement: ($) =>
      seq(
        $.partial_block_statement_start,
        field("program", repeat($._declaration)),
        $.partial_block_statement_end,
      ),

    // The tag-body counterpart of `partial_block_statement`: same delimiters,
    // but the body holds attributes rather than declarations. Aliased to
    // `partial_block_statement` by `tagBody`.
    _attribute_partial_block_statement: ($) =>
      seq(
        $.partial_block_statement_start,
        field("program", tagBody($)),
        $.partial_block_statement_end,
      ),

    // Handlebars raw blocks, e.g. `{{{{raw}}}} {{not evaluated}} {{{{/raw}}}}`.
    // The body is emitted verbatim -- mustaches inside it are *not* evaluated --
    // so it is scanned as a single external token rather than parsed. `{{{{` is
    // a longer match than `{{{`/`{{`, so the mustache delimiters are unaffected.
    raw_block_statement: ($) =>
      seq(
        $.raw_block_statement_start,
        optional($.raw_block_text),
        $.raw_block_statement_end,
      ),

    raw_block_statement_start: ($) =>
      seq("{{{{", field("path", $.identifier), optional($._arguments), "}}}}"),

    raw_block_statement_end: ($) =>
      seq("{{{{/", field("path", $.identifier), "}}}}"),

    sub_expression: ($) => seq("(", mustacheContent($), ")"),

    // There *must* be either:
    // - 1 or more positional argument and 0 or more hash pairs
    // - 0 or more positional arguments and 1 or more hash pairs
    _arguments: ($) =>
      choice(
        seq(repeat1(field("argument", $._expression)), repeat($.hash_pair)),
        seq(repeat(field("argument", $._expression)), repeat1($.hash_pair)),
      ),

    helper_invocation: ($) =>
      seq(
        field("helper", choice($.identifier, $.path_expression)),
        $._arguments,
      ),

    //
    // Block Expression
    //

    block_statement_start: ($) =>
      seq(
        mustacheOpen("#"),
        field("path", $.identifier),
        optional($._arguments),
        optional($.block_params),
        mustacheClose(),
      ),

    block_statement_end: ($) =>
      seq(mustacheOpen("/"), field("path", $.identifier), mustacheClose()),

    else_statement: ($) =>
      seq(
        mustacheOpen(),
        "else",
        optional(mustacheContent($)),
        mustacheClose(),
      ),

    block_statement: ($) =>
      seq(
        $.block_statement_start,
        repeat(choice(field("program", $._declaration), $.else_statement)),
        $.block_statement_end,
      ),

    // The tag-body counterpart of `block_statement` (see `tagBody`), e.g.
    // `<div {{#if x}}data-y="1"{{/if}}>`. Aliased to `block_statement`.
    _attribute_block_statement: ($) =>
      seq(
        $.block_statement_start,
        repeat(choice(field("program", tagBodyItem($)), $.else_statement)),
        $.block_statement_end,
      ),
  },
});
