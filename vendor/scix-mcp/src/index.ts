#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SciXAPIClient } from './client.js';
import { search } from './tools/search.js';
import { getPaper } from './tools/paper.js';
import { getMetrics } from './tools/metrics.js';
import { getCitations, getReferences } from './tools/citations.js';
import { exportCitations } from './tools/export.js';
import { searchDocs } from './search-docs.js';
import {
  getLibraries,
  getLibrary,
  createLibrary,
  deleteLibrary,
  editLibrary,
  manageDocuments,
  addDocumentsByQuery,
  libraryOperation,
  getPermissions,
  updatePermissions,
  transferLibrary,
  getAnnotation,
  manageAnnotation,
  deleteAnnotation
} from './tools/library.js';
import {
  SearchInputSchema,
  GetPaperInputSchema,
  MetricsInputSchema,
  CitationsInputSchema,
  ExportInputSchema,
  GetLibrariesInputSchema,
  GetLibraryInputSchema,
  CreateLibraryInputSchema,
  DeleteLibraryInputSchema,
  EditLibraryInputSchema,
  ManageDocumentsInputSchema,
  AddDocumentsByQueryInputSchema,
  LibraryOperationInputSchema,
  GetPermissionsInputSchema,
  UpdatePermissionsInputSchema,
  TransferLibraryInputSchema,
  GetAnnotationInputSchema,
  ManageAnnotationInputSchema,
  DeleteAnnotationInputSchema,
  SearchDocsInputSchema
} from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const usageGuidePath = path.join(__dirname, '..', 'USAGE_GUIDE.md');

const server = new Server(
  {
    name: 'scix-mcp',
    version: '1.0.12',
  },
  {
    capabilities: {
      tools: {},
      prompts: {},
      resources: {},
    },
  }
);

const client = new SciXAPIClient();

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'search',
        description: 'Search SciX for astronomical literature. Supports full Solr query syntax including author:"Last, F.", title:keyword, abstract:keyword, year:2020-2023, and Boolean operators (AND, OR, NOT).',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query using SciX/Solr syntax',
            },
            rows: {
              type: 'number',
              description: 'Number of results (1-100, default 10)',
              default: 10,
            },
            start: {
              type: 'number',
              description: 'Starting offset for pagination (default 0)',
              default: 0,
            },
            sort: {
              type: 'string',
              enum: ['score desc', 'citation_count desc', 'date desc', 'date asc', 'read_count desc'],
              description: 'Sort order',
              default: 'score desc',
            },
            response_format: {
              type: 'string',
              enum: ['markdown', 'json'],
              description: 'Output format',
              default: 'markdown',
            },
          },
          required: ['query'],
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      {
        name: 'get_paper',
        description: 'Get detailed information about a specific paper by its SciX bibcode (e.g., 2019ApJ...886..145M).',
        inputSchema: {
          type: 'object',
          properties: {
            bibcode: {
              type: 'string',
              description: 'SciX bibcode identifier',
            },
            response_format: {
              type: 'string',
              enum: ['markdown', 'json'],
              default: 'markdown',
            },
          },
          required: ['bibcode'],
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      {
        name: 'get_metrics',
        description: 'Get citation metrics including h-index, citation counts, and paper statistics for a list of bibcodes.',
        inputSchema: {
          type: 'object',
          properties: {
            bibcodes: {
              type: 'array',
              items: { type: 'string' },
              description: 'List of SciX bibcodes (1-2000)',
            },
            response_format: {
              type: 'string',
              enum: ['markdown', 'json'],
              default: 'markdown',
            },
          },
          required: ['bibcodes'],
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      {
        name: 'get_citations',
        description: 'Get papers that cite a given paper (forward citations).',
        inputSchema: {
          type: 'object',
          properties: {
            bibcode: {
              type: 'string',
              description: 'SciX bibcode identifier',
            },
            rows: {
              type: 'number',
              description: 'Number of citations to return (1-100, default 20)',
              default: 20,
            },
            response_format: {
              type: 'string',
              enum: ['markdown', 'json'],
              default: 'markdown',
            },
          },
          required: ['bibcode'],
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      {
        name: 'get_references',
        description: 'Get papers referenced by a given paper (backward citations).',
        inputSchema: {
          type: 'object',
          properties: {
            bibcode: {
              type: 'string',
              description: 'SciX bibcode identifier',
            },
            rows: {
              type: 'number',
              description: 'Number of references to return (1-100, default 20)',
              default: 20,
            },
            response_format: {
              type: 'string',
              enum: ['markdown', 'json'],
              default: 'markdown',
            },
          },
          required: ['bibcode'],
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      {
        name: 'export',
        description: 'Export citations in 25+ academic formats (BibTeX, AASTeX, EndNote, IEEE, MNRAS, etc.) with support for custom formatting templates.',
        inputSchema: {
          type: 'object',
          properties: {
            bibcodes: {
              type: 'array',
              items: { type: 'string' },
              description: 'List of SciX bibcodes to export (1-2000)',
            },
            format: {
              type: 'string',
              enum: [
                'aastex',
                'ads',
                'agu',
                'ams',
                'bibtex',
                'bibtexabs',
                'custom',
                'dcxml',
                'endnote',
                'gsa',
                'icarus',
                'ieee',
                'jatsxml',
                'medlars',
                'mnras',
                'procite',
                'refabsxml',
                'refworks',
                'refxml',
                'ris',
                'rss',
                'soph',
                'votable'
              ],
              description: 'Export format',
            },
            custom_format: {
              type: 'string',
              description: 'Custom format string using field specifiers (required when format is custom)',
            },
            sort: {
              type: 'string',
              description: 'Sort order for bibcodes (e.g., "date desc", "first_author asc")',
            },
            maxauthor: {
              type: 'number',
              description: 'Maximum number of authors to display (default: 200)',
            },
            authorcutoff: {
              type: 'number',
              description: 'Number of authors before using "et al."',
            },
            journalformat: {
              type: 'number',
              description: 'Journal name format: 1 (AASTeX macros), 2 (abbreviations), 3 (full names)',
            },
            keyformat: {
              type: 'string',
              description: 'BibTeX key format template (e.g., "%1H%Y" for FirstAuthorYear)',
            },
          },
          required: ['bibcodes', 'format'],
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      {
        name: 'get_libraries',
        description: 'Get all libraries for the authenticated user. Can filter by type (all, owner, collaborator).',
        inputSchema: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: ['all', 'owner', 'collaborator'],
              description: 'Filter by library type',
              default: 'all',
            },
            response_format: {
              type: 'string',
              enum: ['markdown', 'json'],
              default: 'markdown',
            },
          },
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      {
        name: 'get_library',
        description: 'Get details about a specific library including metadata and list of documents.',
        inputSchema: {
          type: 'object',
          properties: {
            library_id: {
              type: 'string',
              description: 'Library identifier',
            },
            response_format: {
              type: 'string',
              enum: ['markdown', 'json'],
              default: 'markdown',
            },
          },
          required: ['library_id'],
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      {
        name: 'create_library',
        description: 'Create a new library with optional initial documents.',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Library name (1-255 characters)',
            },
            description: {
              type: 'string',
              description: 'Library description (optional)',
            },
            public: {
              type: 'boolean',
              description: 'Whether library is public',
              default: false,
            },
            bibcodes: {
              type: 'array',
              items: { type: 'string' },
              description: 'Initial bibcodes to add (optional)',
            },
            response_format: {
              type: 'string',
              enum: ['markdown', 'json'],
              default: 'markdown',
            },
          },
          required: ['name'],
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      {
        name: 'delete_library',
        description: 'Delete a library permanently.',
        inputSchema: {
          type: 'object',
          properties: {
            library_id: {
              type: 'string',
              description: 'Library identifier',
            },
            response_format: {
              type: 'string',
              enum: ['markdown', 'json'],
              default: 'markdown',
            },
          },
          required: ['library_id'],
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      {
        name: 'edit_library',
        description: 'Edit library metadata (name, description, public status).',
        inputSchema: {
          type: 'object',
          properties: {
            library_id: {
              type: 'string',
              description: 'Library identifier',
            },
            name: {
              type: 'string',
              description: 'New library name (optional)',
            },
            description: {
              type: 'string',
              description: 'New library description (optional)',
            },
            public: {
              type: 'boolean',
              description: 'Whether library is public (optional)',
            },
            response_format: {
              type: 'string',
              enum: ['markdown', 'json'],
              default: 'markdown',
            },
          },
          required: ['library_id'],
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      {
        name: 'manage_documents',
        description: 'Add or remove documents from a library.',
        inputSchema: {
          type: 'object',
          properties: {
            library_id: {
              type: 'string',
              description: 'Library identifier',
            },
            bibcodes: {
              type: 'array',
              items: { type: 'string' },
              description: 'List of bibcodes (1-2000)',
            },
            action: {
              type: 'string',
              enum: ['add', 'remove'],
              description: 'Action to perform',
            },
            response_format: {
              type: 'string',
              enum: ['markdown', 'json'],
              default: 'markdown',
            },
          },
          required: ['library_id', 'bibcodes', 'action'],
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      {
        name: 'add_documents_by_query',
        description: 'Add documents to a library from a SciX search query.',
        inputSchema: {
          type: 'object',
          properties: {
            library_id: {
              type: 'string',
              description: 'Library identifier',
            },
            query: {
              type: 'string',
              description: 'SciX search query',
            },
            rows: {
              type: 'number',
              description: 'Number of results to add (1-2000, default 25)',
              default: 25,
            },
            response_format: {
              type: 'string',
              enum: ['markdown', 'json'],
              default: 'markdown',
            },
          },
          required: ['library_id', 'query'],
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      {
        name: 'library_operation',
        description: 'Perform set operations on libraries (union, intersection, difference, copy, empty).',
        inputSchema: {
          type: 'object',
          properties: {
            library_id: {
              type: 'string',
              description: 'Target library identifier',
            },
            operation: {
              type: 'string',
              enum: ['union', 'intersection', 'difference', 'copy', 'empty'],
              description: 'Operation to perform',
            },
            source_library_ids: {
              type: 'array',
              items: { type: 'string' },
              description: 'Source library IDs for set operations (optional)',
            },
            name: {
              type: 'string',
              description: 'Name for new library (for copy operation, optional)',
            },
            description: {
              type: 'string',
              description: 'Description for new library (for copy operation, optional)',
            },
            response_format: {
              type: 'string',
              enum: ['markdown', 'json'],
              default: 'markdown',
            },
          },
          required: ['library_id', 'operation'],
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      {
        name: 'get_permissions',
        description: 'Get permission information for a library.',
        inputSchema: {
          type: 'object',
          properties: {
            library_id: {
              type: 'string',
              description: 'Library identifier',
            },
            response_format: {
              type: 'string',
              enum: ['markdown', 'json'],
              default: 'markdown',
            },
          },
          required: ['library_id'],
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      {
        name: 'update_permissions',
        description: 'Grant or modify permissions for a user on a library.',
        inputSchema: {
          type: 'object',
          properties: {
            library_id: {
              type: 'string',
              description: 'Library identifier',
            },
            email: {
              type: 'string',
              description: 'User email',
            },
            permission: {
              type: 'string',
              enum: ['owner', 'admin', 'write', 'read'],
              description: 'Permission level to grant',
            },
            response_format: {
              type: 'string',
              enum: ['markdown', 'json'],
              default: 'markdown',
            },
          },
          required: ['library_id', 'email', 'permission'],
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      {
        name: 'transfer_library',
        description: 'Transfer ownership of a library to another user.',
        inputSchema: {
          type: 'object',
          properties: {
            library_id: {
              type: 'string',
              description: 'Library identifier',
            },
            email: {
              type: 'string',
              description: 'Email of new owner',
            },
            response_format: {
              type: 'string',
              enum: ['markdown', 'json'],
              default: 'markdown',
            },
          },
          required: ['library_id', 'email'],
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      {
        name: 'get_annotation',
        description: 'Get annotation/note for a document in a library.',
        inputSchema: {
          type: 'object',
          properties: {
            library_id: {
              type: 'string',
              description: 'Library identifier',
            },
            bibcode: {
              type: 'string',
              description: 'Bibcode to get annotation for',
            },
            response_format: {
              type: 'string',
              enum: ['markdown', 'json'],
              default: 'markdown',
            },
          },
          required: ['library_id', 'bibcode'],
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      {
        name: 'manage_annotation',
        description: 'Add or update an annotation/note for a document in a library.',
        inputSchema: {
          type: 'object',
          properties: {
            library_id: {
              type: 'string',
              description: 'Library identifier',
            },
            bibcode: {
              type: 'string',
              description: 'Bibcode to annotate',
            },
            content: {
              type: 'string',
              description: 'Annotation content (1-10000 characters)',
            },
            response_format: {
              type: 'string',
              enum: ['markdown', 'json'],
              default: 'markdown',
            },
          },
          required: ['library_id', 'bibcode', 'content'],
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      {
        name: 'delete_annotation',
        description: 'Delete an annotation/note for a document in a library.',
        inputSchema: {
          type: 'object',
          properties: {
            library_id: {
              type: 'string',
              description: 'Library identifier',
            },
            bibcode: {
              type: 'string',
              description: 'Bibcode to remove annotation from',
            },
            response_format: {
              type: 'string',
              enum: ['markdown', 'json'],
              default: 'markdown',
            },
          },
          required: ['library_id', 'bibcode'],
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      {
        name: 'search_docs',
        description: 'Search SciX help documentation for information about search syntax, features, API usage, and best practices.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Natural language search query (e.g., "how to search by author", "export formats", "library permissions")',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of results to return (1-20, default 5)',
              default: 5,
            },
          },
          required: ['query'],
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
    ],
  };
});

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      {
        uri: 'scix://usage-guide',
        name: 'SciX Usage Guide',
        description: 'Comprehensive guide for using the SciX MCP server: search syntax, workflows, tools reference, and best practices.',
        mimeType: 'text/markdown',
      },
    ],
  };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;

  if (uri !== 'scix://usage-guide') {
    throw new Error(`Unknown resource: ${uri}`);
  }

  const content = await readFile(usageGuidePath, 'utf-8');

  return {
    contents: [
      {
        uri,
        mimeType: 'text/markdown',
        text: content,
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'search': {
        const input = SearchInputSchema.parse(args);
        const result = await search(client, input);
        return {
          content: [{ type: 'text', text: result }],
        };
      }

      case 'get_paper': {
        const input = GetPaperInputSchema.parse(args);
        const result = await getPaper(client, input);
        return {
          content: [{ type: 'text', text: result }],
        };
      }

      case 'get_metrics': {
        const input = MetricsInputSchema.parse(args);
        const result = await getMetrics(client, input);
        return {
          content: [{ type: 'text', text: result }],
        };
      }

      case 'get_citations': {
        const input = CitationsInputSchema.parse(args);
        const result = await getCitations(client, input);
        return {
          content: [{ type: 'text', text: result }],
        };
      }

      case 'get_references': {
        const input = CitationsInputSchema.parse(args);
        const result = await getReferences(client, input);
        return {
          content: [{ type: 'text', text: result }],
        };
      }

      case 'export': {
        const input = ExportInputSchema.parse(args);
        const result = await exportCitations(client, input);
        return {
          content: [{ type: 'text', text: result }],
        };
      }

      case 'get_libraries': {
        const input = GetLibrariesInputSchema.parse(args);
        const result = await getLibraries(client, input);
        return {
          content: [{ type: 'text', text: result }],
        };
      }

      case 'get_library': {
        const input = GetLibraryInputSchema.parse(args);
        const result = await getLibrary(client, input);
        return {
          content: [{ type: 'text', text: result }],
        };
      }

      case 'create_library': {
        const input = CreateLibraryInputSchema.parse(args);
        const result = await createLibrary(client, input);
        return {
          content: [{ type: 'text', text: result }],
        };
      }

      case 'delete_library': {
        const input = DeleteLibraryInputSchema.parse(args);
        const result = await deleteLibrary(client, input);
        return {
          content: [{ type: 'text', text: result }],
        };
      }

      case 'edit_library': {
        const input = EditLibraryInputSchema.parse(args);
        const result = await editLibrary(client, input);
        return {
          content: [{ type: 'text', text: result }],
        };
      }

      case 'manage_documents': {
        const input = ManageDocumentsInputSchema.parse(args);
        const result = await manageDocuments(client, input);
        return {
          content: [{ type: 'text', text: result }],
        };
      }

      case 'add_documents_by_query': {
        const input = AddDocumentsByQueryInputSchema.parse(args);
        const result = await addDocumentsByQuery(client, input);
        return {
          content: [{ type: 'text', text: result }],
        };
      }

      case 'library_operation': {
        const input = LibraryOperationInputSchema.parse(args);
        const result = await libraryOperation(client, input);
        return {
          content: [{ type: 'text', text: result }],
        };
      }

      case 'get_permissions': {
        const input = GetPermissionsInputSchema.parse(args);
        const result = await getPermissions(client, input);
        return {
          content: [{ type: 'text', text: result }],
        };
      }

      case 'update_permissions': {
        const input = UpdatePermissionsInputSchema.parse(args);
        const result = await updatePermissions(client, input);
        return {
          content: [{ type: 'text', text: result }],
        };
      }

      case 'transfer_library': {
        const input = TransferLibraryInputSchema.parse(args);
        const result = await transferLibrary(client, input);
        return {
          content: [{ type: 'text', text: result }],
        };
      }

      case 'get_annotation': {
        const input = GetAnnotationInputSchema.parse(args);
        const result = await getAnnotation(client, input);
        return {
          content: [{ type: 'text', text: result }],
        };
      }

      case 'manage_annotation': {
        const input = ManageAnnotationInputSchema.parse(args);
        const result = await manageAnnotation(client, input);
        return {
          content: [{ type: 'text', text: result }],
        };
      }

      case 'delete_annotation': {
        const input = DeleteAnnotationInputSchema.parse(args);
        const result = await deleteAnnotation(client, input);
        return {
          content: [{ type: 'text', text: result }],
        };
      }

      case 'search_docs': {
        const input = SearchDocsInputSchema.parse(args);
        const results = await searchDocs(input.query, input.limit);

        if (results.length === 0) {
          return {
            content: [{ type: 'text', text: 'No documentation found for your query.' }],
          };
        }

        const formatted = results.map((r, i) => {
          let text = `## ${i + 1}. ${r.title}\n`;
          if (r.subsection) {
            text += `**Section**: ${r.section} > ${r.subsection}\n`;
          } else if (r.section) {
            text += `**Section**: ${r.section}\n`;
          }
          text += `**Source**: ${r.source_file} ([view online](${r.source_url}))\n`;
          text += `**Relevance**: ${r.score.toFixed(1)}\n\n`;
          text += `${r.snippet}\n`;
          return text;
        }).join('\n---\n\n');

        const header = `# SciX Documentation Search Results\n\nFound ${results.length} result${results.length === 1 ? '' : 's'} for "${input.query}":\n\n`;

        return {
          content: [{ type: 'text', text: header + formatted }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
});

server.setRequestHandler(ListPromptsRequestSchema, async () => {
  return {
    prompts: [
      {
        name: 'search-workflow',
        description: 'Guide for searching astronomical literature effectively using SciX search syntax, operators, and best practices.',
      },
      {
        name: 'library-management',
        description: 'Workflows for creating, managing, and organizing paper collections in SciX libraries.',
      },
      {
        name: 'citation-analysis',
        description: 'Techniques for analyzing citation metrics, h-index, and citation networks.',
      },
      {
        name: 'export-bibliography',
        description: 'Methods for exporting citations in various formats (BibTeX, AASTeX, EndNote, etc.).',
      },
      {
        name: 'best-practices',
        description: 'General best practices, performance tips, and error handling for the SciX MCP server.',
      },
    ],
  };
});

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const { name } = request.params;

  switch (name) {
    case 'search-workflow':
      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `# SciX Literature Search Guide

## Search Tool Overview

The \`search\` tool is your primary method for finding astronomical papers. It uses Solr query syntax for powerful, precise searches.

## Key Search Patterns

**Author searches:**
- \`author:"Last, F."\` - Exact author match
- \`author:^Last\` - First author only
- Always use quotes for exact matches

**Field-specific searches:**
- \`title:keyword\` - Search in titles
- \`abstract:"exact phrase"\` - Search abstracts with quotes for phrases
- \`year:2020-2023\` - Year ranges
- \`property:refereed\` - Peer-reviewed papers only

**Citation-based searches:**
- \`citations(bibcode:X)\` - Find papers that cite X
- \`references(bibcode:X)\` - Find papers cited by X

**Boolean operators (must be UPPERCASE):**
- \`AND\`, \`OR\`, \`NOT\`
- Example: \`(dark energy OR dark matter) AND year:2020-2023\`

## Sorting Options

- \`score desc\` (default) - Relevance ranking
- \`citation_count desc\` - Most cited first
- \`date desc/asc\` - Publication date
- \`read_count desc\` - Most read papers

## Pagination

- Use \`rows\` parameter (1-100) to limit results
- Use \`start\` parameter for pagination (e.g., start=0, start=10, start=20)
- For large result sets (>100), use Solr cursormark pagination

## Query Construction Best Practices

1. **Start broad, refine narrow**: Begin with key terms, then add filters
2. **Use field-specific searches**: More accurate than full-text
3. **Check numFound**: If too many results, add filters; if too few, broaden
4. **Combine strategically**: Use parentheses to group conditions

## Example Workflows

**Find recent papers by author:**
\`\`\`
search(
  query="author:\\"Einstein, A.\\" year:2020-2024",
  sort="date desc",
  rows=20
)
\`\`\`

**Find highly-cited review papers:**
\`\`\`
search(
  query="title:review AND property:refereed",
  sort="citation_count desc",
  rows=10
)
\`\`\`

**Literature review workflow:**
1. Broad search with topic + year range
2. Use \`get_metrics\` on top results to identify key papers
3. Use \`get_references\` on key papers for foundational work
4. Use \`get_citations\` to find recent developments`,
            },
          },
        ],
      };

    case 'library-management':
      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `# SciX Library Management Guide

## What are Libraries?

Libraries are personal collections of papers with optional annotations. They're perfect for organizing research, building reading lists, or curating bibliographies.

## Core Library Operations

### Creating Libraries

\`\`\`
create_library(
  name="My Research Collection",
  description="Papers on exoplanet detection methods",
  public=false,
  bibcodes=["2023ApJ...950..123S", "2022MNRAS.517.1234T"]
)
\`\`\`

Returns a \`library_id\` needed for all other operations.

### Listing and Viewing

\`\`\`
get_libraries(type="owner")  # List your libraries
get_library(library_id="...")  # View library contents
\`\`\`

### Editing Metadata

\`\`\`
edit_library(
  library_id="...",
  name="Updated Name",
  description="New description",
  public=true
)
\`\`\`

## Document Management

### Adding/Removing Papers

\`\`\`
manage_documents(
  library_id="...",
  bibcodes=["2023ApJ...950..123S"],
  action="add"
)
\`\`\`

Operations are idempotent - adding existing documents is safe.

### Bulk Add from Search

\`\`\`
add_documents_by_query(
  library_id="...",
  query="author:\\"Smith, J.\\" year:2023",
  rows=25
)
\`\`\`

Perfect for "add all papers by author X" scenarios.

## Library Operations

### Set Operations

\`\`\`
library_operation(
  library_id="target_id",
  operation="union",
  source_library_ids=["lib1", "lib2"]
)
\`\`\`

Available operations:
- \`union\` - Combine libraries (OR)
- \`intersection\` - Common papers (AND)
- \`difference\` - Papers in target not in sources
- \`copy\` - Duplicate with new name
- \`empty\` - Remove all documents (keep library)

## Annotations

Add research notes to papers within a library context:

\`\`\`
manage_annotation(
  library_id="...",
  bibcode="2023ApJ...950..123S",
  content="Important findings: ..."
)
\`\`\`

Annotations are per-document and specific to each library.

## Sharing and Permissions

### View Permissions

\`\`\`
get_permissions(library_id="...")
\`\`\`

### Grant Access

\`\`\`
update_permissions(
  library_id="...",
  email="colleague@university.edu",
  permission="read"  # or "write", "admin", "owner"
)
\`\`\`

### Transfer Ownership

\`\`\`
transfer_library(
  library_id="...",
  email="new_owner@university.edu"
)
\`\`\`

### Public Sharing

Public libraries can be shared at:
\`https://scixplorer.org/public-libraries/<library_id>\`

## Example Workflows

**Building a reading list:**
1. \`create_library(name="Reading List - Exoplanets")\`
2. \`add_documents_by_query(query="exoplanet detection year:2023-2024")\`
3. \`manage_annotation\` for each paper after reading

**Collaborative research collection:**
1. \`create_library(name="Team Project", public=false)\`
2. Add initial papers
3. \`update_permissions\` to grant team access
4. Share library URL with team`,
            },
          },
        ],
      };

    case 'citation-analysis':
      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `# SciX Citation Analysis Guide

## Citation Metrics Overview

Use these tools to analyze research impact, track citations, and identify influential papers.

## Core Tools

### get_metrics - Citation Statistics

Calculate h-index and citation metrics for paper collections (1-2000 bibcodes):

\`\`\`
get_metrics(
  bibcodes=["2023ApJ...950..123S", "2022MNRAS.517.1234T"],
  response_format="markdown"
)
\`\`\`

**Returns:**
- h-index, g-index, i10-index
- Total citations
- Paper counts (total, refereed, first-author)
- Usage statistics (reads, downloads)

### get_citations - Forward Citations

Find papers that cite a given paper:

\`\`\`
get_citations(
  bibcode="2020ApJ...905....3A",
  rows=20,
  response_format="markdown"
)
\`\`\`

**Use cases:**
- Track paper impact over time
- Find recent work building on foundational papers
- Identify research trends

### get_references - Backward Citations

Find papers cited by a given paper:

\`\`\`
get_references(
  bibcode="2020ApJ...905....3A",
  rows=20,
  response_format="markdown"
)
\`\`\`

**Use cases:**
- Literature review
- Find foundational papers in a field
- Understand paper context

## Analysis Workflows

### Author Impact Analysis

1. Search for author's papers:
   \`\`\`
   search(query="author:\\"Last, F.\\" AND property:refereed")
   \`\`\`

2. Calculate metrics on all papers:
   \`\`\`
   get_metrics(bibcodes=[...])
   \`\`\`

3. Analyze top papers:
   \`\`\`
   get_citations(bibcode="most_cited_paper")
   \`\`\`

### Find Seminal Papers

1. Broad topic search:
   \`\`\`
   search(query="dark matter detection", sort="citation_count desc")
   \`\`\`

2. Get citations for top results:
   \`\`\`
   get_citations(bibcode="top_result")
   \`\`\`

Highly cited papers with many forward citations = foundational work

### Track Citation Metrics Over Time

1. Get author's papers with search
2. Run \`get_metrics\` to get current h-index and citations
3. Store results for comparison later
4. Repeat periodically to track growth

### Literature Review with Citation Network

1. Find key paper on topic
2. \`get_references\` - foundational papers cited
3. \`get_citations\` - recent developments
4. Create library with all papers
5. Add annotations as you read

## Understanding Metrics

**h-index**: An author has h-index of h if h papers have at least h citations each
- Common metric for researcher impact
- Combines productivity and citation impact

**g-index**: Largest number g where top g papers have ≥ g² citations combined
- Gives more weight to highly-cited papers

**i10-index**: Number of papers with at least 10 citations
- Simple productivity metric

## Best Practices

- Use \`response_format="json"\` for programmatic analysis
- Batch bibcodes (up to 2000) for efficiency
- Combine with library tools to organize analysis
- Consider both metrics AND qualitative impact`,
            },
          },
        ],
      };

    case 'export-bibliography':
      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `# SciX Bibliography Export Guide

## Export Tool Overview

The \`export\` tool generates formatted citations from bibcodes in various academic formats, with support for custom formatting templates.

## Discovering Available Formats

**Use the /manifest endpoint** to get a complete list of available export formats:
- The manifest returns all supported formats with metadata
- Formats include type (text, XML, HTML, LaTeX, tagged, custom)
- Each format has a route, extension, and name

## All Available Export Formats

**Standard Formats (25+ options):**
- \`bibtex\` - BibTeX format for LaTeX
- \`bibtexabs\` - BibTeX with abstracts
- \`aastex\` - American Astronomical Society (AAS) format
- \`ads\` - ADS tagged format
- \`endnote\` - EndNote reference manager
- \`procite\` - ProCite format
- \`ris\` - RIS format (Reference Manager)
- \`refworks\` - RefWorks format
- \`medlars\` - MEDLARS format for medical literature
- \`dcxml\` - Dublin Core XML
- \`refxml\` - Reference XML
- \`refabsxml\` - Reference XML with abstracts
- \`jatsxml\` - JATS XML format
- \`votable\` - VOTable XML format
- \`rss\` - RSS feed format
- \`mnras\` - Monthly Notices RAS format
- \`soph\` - Solar Physics format
- \`icarus\` - Icarus journal format
- \`ams\` - American Meteorological Society
- \`agu\` - American Geophysical Union
- \`gsa\` - Geological Society of America
- \`ieee\` - IEEE format
- \`custom\` - **Custom format with printf-like syntax**

## Basic Usage

\`\`\`
export(
  bibcodes=["2023ApJ...950..123S", "2022MNRAS.517.1234T"],
  format="bibtex"
)
\`\`\`

Returns plain text in the chosen format, ready to paste into your bibliography.

## Custom Format Syntax

Create **custom bibliography formats** using printf-like field specifiers:

### Field Specifiers

- \`%R\` - Bibcode
- \`%A\` - Author list
- \`%l\` - Last name of first author
- \`%Y\` - Year
- \`%T\` - Title
- \`%j\` - Journal (formatted)
- \`%J\` - Journal (full name)
- \`%V\` - Volume
- \`%p\` - Page or article ID
- \`%G\` - Author list (surname, initials)
- \`%u\` - URL to ADS abstract page

### Encoding Options

- \`%ZEncoding:unicode\` - Unicode encoding (default)
- \`%ZEncoding:html\` - HTML entities
- \`%ZEncoding:latex\` - LaTeX special characters
- \`%ZEncoding:csv\` - CSV-safe encoding

### Format Controls

- \`%ZLinelength:80\` - Set line wrap length
- \`%ZHeader:"text"\` - Add header line
- \`%ZFooter:"text"\` - Add footer line

### Custom Format Examples

**Simple reference list:**
\`\`\`
export(
  bibcodes=["2023ApJ...950..123S"],
  format="custom",
  custom_format="%l (%Y), %j, %V, %p.\\n"
)
\`\`\`
Output: "Smith (2023), ApJ, 950, 123."

**CSV export:**
\`\`\`
export(
  bibcodes=[...],
  format="custom",
  custom_format="%ZEncoding:csv %ZHeader:'Author,Year,Title,Journal'\\n%G,%Y,%T,%J"
)
\`\`\`

**LaTeX with hyperlinks:**
\`\`\`
export(
  bibcodes=[...],
  format="custom",
  custom_format="\\\\item \\\\href{%u}{%R} %A: \\\\textit{%T,} %j,%V,%p (%Y)"
)
\`\`\`

**Markdown list:**
\`\`\`
export(
  bibcodes=[...],
  format="custom",
  custom_format="- **%l et al. (%Y)**: [%T](%u), *%j*, %V, %p\\n"
)
\`\`\`

## Advanced Export Parameters

Control author display and formatting:

**maxauthor**: Maximum number of authors to display (default: 200)
\`\`\`
export(bibcodes=[...], format="aastex", maxauthor=3)
\`\`\`

**authorcutoff**: Number of authors before using "et al."
\`\`\`
export(bibcodes=[...], format="bibtex", authorcutoff=5)
\`\`\`

**journalformat**: Journal name format
- \`1\` - Use AASTeX macros (\\apj, \\mnras, etc.)
- \`2\` - Use abbreviations (ApJ, MNRAS, etc.)
- \`3\` - Full journal names
\`\`\`
export(bibcodes=[...], format="aastex", journalformat=1)
\`\`\`

**keyformat**: BibTeX key format (for bibtex/bibtexabs)
- Template with %1H (first author), %Y (year), %zm (journal abbreviation)
\`\`\`
export(bibcodes=[...], format="bibtex", keyformat="%1H%Y")
\`\`\`

**sort**: Sort order for bibcodes
- Can use any valid sort field (e.g., "date desc", "first_author asc")
\`\`\`
export(bibcodes=[...], format="bibtex", sort="date desc")
\`\`\`

## Capacity

- Accepts 1-2000 bibcodes per request
- For larger bibliographies, split into batches
- Results are returned as plain text

## Workflow Examples

### Build Bibliography for Paper

1. Search for relevant papers:
   \`\`\`
   search(query="exoplanet detection methods year:2020-2024", rows=50)
   \`\`\`

2. Extract bibcodes from results

3. Export in desired format:
   \`\`\`
   export(bibcodes=[...], format="bibtex", journalformat=2)
   \`\`\`

4. Copy output to your LaTeX document

### Export Library Contents with Custom Format

1. Get library papers:
   \`\`\`
   get_library(library_id="...")
   \`\`\`

2. Extract bibcodes from library

3. Export with custom format for blog post:
   \`\`\`
   export(
     bibcodes=[...],
     format="custom",
     custom_format="- [%T](%u) by %A (%Y)\\n",
     sort="date desc"
   )
   \`\`\`

### Create Bibliography from Citation Network

1. Start with key paper
2. Get references and citations:
   \`\`\`
   get_references(bibcode="...")
   get_citations(bibcode="...")
   \`\`\`

3. Combine bibcodes from both
4. Export merged list with author limit:
   \`\`\`
   export(bibcodes=[...], format="aastex", maxauthor=10, authorcutoff=3)
   \`\`\`

### Export for Specific Journal Requirements

**ApJ submission:**
\`\`\`
export(bibcodes=[...], format="aastex", journalformat=1)
\`\`\`

**MNRAS submission:**
\`\`\`
export(bibcodes=[...], format="mnras")
\`\`\`

**IEEE paper:**
\`\`\`
export(bibcodes=[...], format="ieee")
\`\`\`

## Format-Specific Tips

### BibTeX / BibTeXabs

- Most common for LaTeX users
- Automatically generates cite keys (customize with keyformat)
- Compatible with BibLaTeX
- Use \`bibtexabs\` to include abstracts

### AASTeX

- Required for AAS journal submissions (ApJ, AJ, ApJS, etc.)
- Uses \`\\bibitem\` format
- Set \`journalformat=1\` for AASTeX journal macros

### EndNote / ProCite / RIS / RefWorks

- Import directly into reference managers
- Preserves all metadata
- Good for non-LaTeX workflows
- Each tool has its own preferred format

### XML Formats (JATS, Dublin Core, VOTable)

- Structured metadata export
- Machine-readable
- Good for data processing pipelines
- JATS XML common for journal publishing systems

### Custom Format

- **Maximum flexibility** for any output style
- Supports all field specifiers
- Can generate markdown, HTML, LaTeX, CSV, or plain text
- Perfect for journal styles not in standard formats
- Use encoding options to ensure proper character handling

## Integration with Libraries

**Best practice:** Create a library for your paper, then export:

1. \`create_library(name="Paper Bibliography")\`
2. Add papers via search or manual selection
3. Review and annotate
4. Export when ready to cite (with custom format if needed)
5. Update library as paper evolves

This workflow ensures you can track which papers you've reviewed and re-export as needed.

## Performance Tips

- Batch export requests when possible
- Cache exported bibliographies locally
- Use libraries to organize papers before exporting
- Consider response size for very large bibliographies (2000 papers)
- Use custom format instead of post-processing output when possible`,
            },
          },
        ],
      };

    case 'best-practices':
      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `# SciX MCP Server - Best Practices & Tips

## Core Concepts

**Bibcode**: Unique identifier format \`YYYYJJJJJVVVVMPPPPA\`
- YYYY = year
- JJJJJ = journal
- VVVV = volume
- M = section
- PPPP = page
- A = first author initial

Example: \`2019ApJ...886..145M\`

**Response Formats**: Most tools support:
- \`markdown\` (default) - Human-readable
- \`json\` - Machine-readable for programmatic use

## Performance Optimization

### Request Efficiency

1. **Limit results**: Use \`rows\` parameter appropriately
   - Don't request 100 results when you need 10
   - Default is usually sufficient

2. **Batch operations**: Combine multiple bibcodes in one request
   - \`get_metrics\` accepts up to 2000 bibcodes
   - \`export\` accepts up to 2000 bibcodes
   - More efficient than individual requests

3. **Cache bibcodes**: Store bibcodes for papers of interest
   - Metadata changes rarely
   - Avoids repeated searches

4. **Choose format wisely**:
   - Use \`markdown\` for human review
   - Use \`json\` only when parsing programmatically

### Large Result Sets

For pagination beyond 100 results:
- Use Solr \`cursormark\` pagination
- More stable than offset-based \`start\` parameter
- Set \`cursormark=*\` initially
- Use stable \`sort\`
- Loop until \`nextCursorMark\` repeats

For bulk queries:
- Use ADS BigQuery endpoint (not via this MCP server)
- Avoids thousands of individual \`search\` calls

## Error Handling

### Common Errors

**No results from search:**
- Try broader terms
- Remove filters
- Check spelling
- Verify field syntax (quotes, operators)

**Too many results:**
- Add field-specific filters
- Use Boolean operators
- Narrow year range
- Add \`property:refereed\`

**Invalid bibcode:**
- Use \`search\` to find correct bibcode first
- Verify format: YYYYJJJJJVVVVMPPPPA
- Check for typos

**Rate limits:**
- Default: 5000 requests/day per API key
- Contact adshelp@cfa.harvard.edu for higher limits
- Monitor rate limit headers in responses

## Rate Limits

- **Daily limit**: 5000 requests per API token
- Rate limit info returned in response headers
- Plan workflows to minimize requests
- Use batch operations when possible

## Security Best Practices

- Store API token in environment variables, not code
- Use \`.env\` files (not committed to git)
- Don't share API tokens
- Rotate tokens periodically

## Data Organization

### When to Use Libraries

Use libraries for:
- Reading lists
- Research collections
- Bibliographies in progress
- Collaborative projects
- Paper tracking

Don't use libraries for:
- One-time searches
- Quick lookups
- Throwaway queries

### Annotation Strategy

Good annotation practices:
- Summarize key findings
- Note methodology
- Record relevance to your research
- Track follow-up questions
- Max 10,000 characters per annotation

## Response Format Selection

**Use Markdown when:**
- Presenting to users
- Quick review needed
- Human readability priority

**Use JSON when:**
- Programmatic processing required
- Integrating with other tools
- Need full data structure
- Building automated workflows

## Bibcode Limits

Tool-specific limits:
- \`search\`: Max 100 rows per request
- \`get_metrics\`: 1-2000 bibcodes
- \`export\`: 1-2000 bibcodes
- \`manage_documents\`: 1-2000 bibcodes
- \`add_documents_by_query\`: Max 2000 rows

## Integration Tips

When building workflows:
1. **Always show bibcodes** in results for reference
2. **Explain search strategy** when refining queries
3. **Suggest related tools** (e.g., after search, offer metrics)
4. **Batch operations** for related actions
5. **Verify library operations** by checking contents after modifications

## Troubleshooting

**Resource not found (404):**
- Verify bibcode format and existence
- Use search to confirm paper exists

**Unauthorized (401):**
- Check SCIX_API_TOKEN environment variable
- Verify token is valid at scixplorer.org

**Rate limit (429):**
- Wait until reset time (check headers)
- Reduce request frequency
- Batch operations more aggressively

**Timeout:**
- Requests timeout after 30 seconds
- Reduce result size (\`rows\` parameter)
- Try narrower query

## Support Resources

- **SciX Homepage**: https://scixplorer.org/
- **API Documentation**: https://github.com/adsabs/adsabs-dev-api
- **Search Syntax**: https://adsabs.github.io/help/search/search-syntax
- **API Issues**: adshelp@cfa.harvard.edu`,
            },
          },
        ],
      };

    default:
      throw new Error(`Unknown prompt: ${name}`);
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('SciX MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
