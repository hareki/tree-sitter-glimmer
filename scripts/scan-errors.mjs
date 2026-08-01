#!/usr/bin/env node

// Parse every template under a directory and report the ones the grammar
// cannot handle, pinpointing the innermost ERROR/MISSING node in each.
//
// This exists so grammar gaps are found in bulk against a real project rather
// than one file at a time, as they happen to be opened in an editor:
//
//   node scripts/scan-errors.mjs --dir ../some-handlebars-app
//
// Exits non-zero when any file fails, so it can gate a release.

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const DEFAULT_EXCLUDES = ["node_modules", ".git", "dist", "build"];

// `tree-sitter parse` takes the files as argv, so batch them to stay well under
// the platform's argument-length limit.
const BATCH_SIZE = 200;

function parseArgs(argv) {
  const options = {
    dir: ".",
    ext: ".hbs",
    excludes: DEFAULT_EXCLUDES,
    // Show at most this many failing files in full; the rest are summarised.
    limit: Infinity,
  };

  for (let i = 0; i < argv.length; i++) {
    const [flag, inlineValue] = argv[i].split(/=(.*)/s);
    const value = inlineValue ?? argv[++i];

    switch (flag) {
      case "--dir":
        options.dir = value;
        break;
      case "--ext":
        options.ext = value.startsWith(".") ? value : `.${value}`;
        break;
      case "--exclude":
        options.excludes = value.split(",").filter(Boolean);
        break;
      case "--limit":
        options.limit = Number(value);
        break;
      default:
        console.error(`Unknown argument: ${flag}`);
        console.error(
          "Usage: scan-errors.mjs [--dir <path>] [--ext .hbs] " +
            "[--exclude a,b] [--limit n]",
        );
        process.exit(2);
    }
  }

  return options;
}

function collectFiles({ dir, ext, excludes }) {
  const files = [];

  for (const entry of readdirSync(dir, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile() || !entry.name.endsWith(ext)) continue;

    // `parentPath` is relative to `dir` only for nested entries, so compare
    // against the whole path to catch an excluded directory at any depth.
    const full = join(entry.parentPath ?? entry.path, entry.name);
    const segments = relative(dir, full).split(sep);
    if (segments.some((segment) => excludes.includes(segment))) continue;

    files.push(full);
  }

  return files.sort();
}

function treeSitter(args) {
  const result = spawnSync("tree-sitter", args, {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });

  if (result.error) {
    console.error(`Failed to run \`tree-sitter\`: ${result.error.message}`);
    process.exit(2);
  }

  return result.stdout ?? "";
}

// A failing file's stat line ends with the outermost error's range. The file
// name is right-padded to a fixed column, so the capture needs trimming.
const STAT_FAILURE = /^(.*?)\s*\t.*\((ERROR|MISSING)[^)]*\)\s*$/;

function findFailures(files) {
  const failures = [];

  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE);
    const stdout = treeSitter(["parse", "--quiet", "--stat", ...batch]);

    for (const line of stdout.split("\n")) {
      const match = line.match(STAT_FAILURE);
      if (match) failures.push(match[1]);
    }
  }

  return failures;
}

const NODE_LINE =
  /^(\s*)\((ERROR|MISSING[^\s[]*)\s*\[(\d+), (\d+)\] - \[(\d+), (\d+)\]/;

// Report only the innermost ERROR/MISSING nodes: an ERROR that contains another
// one is just the recovery envelope, and points at the wrong place.
function innermostErrors(file) {
  const stdout = treeSitter(["parse", file]);
  const nodes = [];

  for (const line of stdout.split("\n")) {
    const match = line.match(NODE_LINE);
    if (!match) continue;

    nodes.push({
      indent: match[1].length,
      kind: match[2],
      row: Number(match[3]),
      column: Number(match[4]),
    });
  }

  return nodes.filter((node, index) => {
    const next = nodes[index + 1];
    return !next || next.indent <= node.indent;
  });
}

function report(file, node, source) {
  const line = source[node.row] ?? "";
  const gutter = String(node.row + 1);
  const pad = " ".repeat(gutter.length);

  console.log(`${file}:${node.row + 1}:${node.column + 1}: ${node.kind}`);
  console.log(`${pad} |`);
  console.log(`${gutter} | ${line}`);
  // Tabs in the source would misalign a space-built caret.
  const prefix = line.slice(0, node.column).replace(/[^\t]/g, " ");
  console.log(`${pad} | ${prefix}^`);
  console.log("");
}

const options = parseArgs(process.argv.slice(2));
const files = collectFiles(options);

if (files.length === 0) {
  console.error(`No ${options.ext} files found under ${options.dir}`);
  process.exit(2);
}

const failures = findFailures(files);

for (const file of failures.slice(0, options.limit)) {
  const source = readFileSync(file, "utf8").split("\n");
  for (const node of innermostErrors(file)) report(file, node, source);
}

if (failures.length > options.limit) {
  console.log(`... and ${failures.length - options.limit} more failing files`);
}

console.log(
  `${failures.length} of ${files.length} ${options.ext} files failed to parse`,
);

process.exit(failures.length === 0 ? 0 : 1);
