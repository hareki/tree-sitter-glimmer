[
  (element_node
    (element_node_start))
  (element_node_void)
  (block_statement
    (block_statement_start))
  (partial_block_statement
    (partial_block_statement_start))
  (mustache_statement)
] @indent.begin

(element_node
  (element_node_end
    ">" @indent.end))

(element_node_void
  "/>" @indent.end)

[
  ">"
  "/>"
  "</"
  "{{/"
  "}}"
] @indent.branch

(else_statement) @indent.branch

(comment_statement) @indent.ignore

; A raw block's body is emitted verbatim, so reindenting it would change the
; rendered output. This is also why `raw_block_statement` is deliberately absent
; from `@indent.begin` above.
(raw_block_text) @indent.ignore
