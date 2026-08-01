
; Tags that start with a capital letter are components
((tag_name) @constructor
  (#match? @constructor "^[A-Z]"))

; === Tag Names ===
; Tags that start with a lower case letter are HTML tags
; We'll also use this highlighting for named blocks (which start with `:`)
((tag_name) @tag
  (#match? @tag "^:?[a-z]"))

; === Doctype ===
(doctype) @keyword

(attribute_name) @attribute

(string_literal) @string

(number_literal) @number

(boolean_literal) @boolean

(concat_statement) @string

; Unquoted attribute values (`<a href=foo.html>`) read like quoted ones
(attribute_value) @string

; === Block Statements ===
; Highlight the brackets
(block_statement_start) @tag.delimiter

(block_statement_end) @tag.delimiter

; Highlight `if`/`each`/`let`
(block_statement_start
  path: (identifier) @keyword)

(block_statement_end
  path: (identifier) @keyword)

((block_statement_start
  (identifier) @keyword.conditional)
  (#eq? @keyword.conditional "if"))

((block_statement_end
  (identifier) @keyword.conditional)
  (#eq? @keyword.conditional "if"))

(else_statement) @tag.delimiter

(else_statement
  "else" @keyword.conditional)

; == Mustache Statements ===
; Highlight the whole statement, to color brackets and separators
(mustache_statement) @tag.delimiter

; An identifier in a mustache expression is a variable
((mustache_statement
  [
    (path_expression
      (identifier) @variable)
    (identifier) @variable
  ])
  (#not-any-of? @variable "yield" "outlet" "this"))

; As are positional arguments to blocks, helpers, and partials. The parents
; are listed explicitly rather than as a wildcard `(_)` so the query engine
; can index each pattern by its root symbol instead of testing every node;
; only rules that use `_arguments` ever carry an `argument:` field.
([
  (block_statement_start
    argument: [
      (path_expression
        (identifier) @variable)
      (identifier) @variable
    ])
  (helper_invocation
    argument: [
      (path_expression
        (identifier) @variable)
      (identifier) @variable
    ])
  (partial_statement
    argument: [
      (path_expression
        (identifier) @variable)
      (identifier) @variable
    ])
  (partial_block_statement_start
    argument: [
      (path_expression
        (identifier) @variable)
      (identifier) @variable
    ])
  (raw_block_statement_start
    argument: [
      (path_expression
        (identifier) @variable)
      (identifier) @variable
    ])
] (#not-eq? @variable "this"))

; As is an identifier in a block param
(block_params
  (identifier) @variable)

; `this` should be highlighted as a built-in variable
((identifier) @variable.builtin
  (#eq? @variable.builtin "this"))

; Parent-context path references (`..`, `../foo`) behave like variables
(parent_path) @variable

; If the identifier is just "yield" or "outlet", it's a keyword
((mustache_statement
  (identifier) @keyword)
  (#any-of? @keyword "yield" "outlet"))

; Helpers are functions
((helper_invocation
  helper: [
    (path_expression
      (identifier) @function)
    (identifier) @function
  ])
  (#not-any-of? @function "if" "yield"))

((helper_invocation
  helper: (identifier) @keyword.conditional)
  (#eq? @keyword.conditional "if"))

((helper_invocation
  helper: (identifier) @keyword)
  (#eq? @keyword "yield"))

; === Partial Statements ===
; Highlight the whole statement, to color the `{{>` brackets and separators
(partial_statement) @tag.delimiter

; Partial blocks: highlight the brackets like other block statements
(partial_block_statement_start) @tag.delimiter

(partial_block_statement_end) @tag.delimiter

; The partial being invoked
(partial_name) @function

; === Raw Block Statements ===
; `{{{{raw}}}} ... {{{{/raw}}}}`; the body is emitted verbatim and stays
; unhighlighted, but the delimiters and helper name read like other blocks
(raw_block_statement_start) @tag.delimiter

(raw_block_statement_end) @tag.delimiter

(raw_block_statement_start
  path: (identifier) @keyword)

(raw_block_statement_end
  path: (identifier) @keyword)

(hash_pair
  key: (identifier) @property)

; Hash values are variables, in any statement type
((hash_pair
  value: [
    (path_expression
      (identifier) @variable)
    (identifier) @variable
  ])
  (#not-eq? @variable "this"))

(comment_statement) @comment

(attribute_node
  "=" @operator)

(block_params
  "as" @keyword)

(block_params
  "|" @operator)

[
  "<"
  ">"
  "</"
  "/>"
] @tag.delimiter
