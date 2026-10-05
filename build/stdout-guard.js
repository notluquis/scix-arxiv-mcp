// stdout carries the MCP protocol; any stray console.log would corrupt it.
// This module must be the FIRST import of the entrypoint (ESM evaluates imports before the importer's body).
console.log = console.error;
console.info = console.error;
console.debug = console.error;
export {};
