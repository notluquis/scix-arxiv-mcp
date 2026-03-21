import { z } from 'zod';

export enum ResponseFormat {
  MARKDOWN = 'markdown',
  JSON = 'json'
}

export enum SortOrder {
  RELEVANCE = 'score desc',
  CITATION_COUNT = 'citation_count desc',
  DATE_DESC = 'date desc',
  DATE_ASC = 'date asc',
  READ_COUNT = 'read_count desc'
}

export const SearchInputSchema = z.object({
  query: z.string().min(1).max(1000).describe('SciX search query using Solr syntax'),
  rows: z.number().int().min(1).max(100).default(10).describe('Number of results to return'),
  start: z.number().int().min(0).default(0).describe('Starting offset for pagination'),
  sort: z.nativeEnum(SortOrder).default(SortOrder.RELEVANCE).describe('Sort order for results'),
  response_format: z.nativeEnum(ResponseFormat).default(ResponseFormat.MARKDOWN).describe('Output format')
});

export const GetPaperInputSchema = z.object({
  bibcode: z.string().min(1).max(19).describe('SciX bibcode identifier'),
  response_format: z.nativeEnum(ResponseFormat).default(ResponseFormat.MARKDOWN)
});

export const MetricsInputSchema = z.object({
  bibcodes: z.array(z.string()).min(1).max(2000).describe('List of bibcodes'),
  response_format: z.nativeEnum(ResponseFormat).default(ResponseFormat.MARKDOWN)
});

export const CitationsInputSchema = z.object({
  bibcode: z.string().min(1).max(19).describe('SciX bibcode identifier'),
  rows: z.number().int().min(1).max(100).default(20).describe('Number of citations to return'),
  response_format: z.nativeEnum(ResponseFormat).default(ResponseFormat.MARKDOWN)
});

export const ExportInputSchema = z.object({
  bibcodes: z.array(z.string()).min(1).max(2000).describe('List of bibcodes to export'),
  format: z.enum([
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
  ]).describe('Export format'),
  custom_format: z.string().optional().describe('Custom format string (required when format is custom)'),
  sort: z.union([z.string(), z.array(z.string())]).optional().describe('Optional sort order (e.g., "date desc")'),
  maxauthor: z.union([z.number().int(), z.array(z.number().int())]).optional().describe('Maximum authors to show before et al.'),
  authorcutoff: z.union([z.number().int(), z.array(z.number().int())]).optional().describe('Author cutoff threshold'),
  journalformat: z.union([z.number().int(), z.array(z.number().int())]).optional().describe('Journal format style code'),
  keyformat: z.union([z.string(), z.array(z.string())]).optional().describe('Citation key format')
}).refine((data) => (data.format === 'custom' ? Boolean(data.custom_format) : true), {
  message: 'custom_format is required when format is custom',
  path: ['custom_format']
});

export type SearchInput = z.infer<typeof SearchInputSchema>;
export type GetPaperInput = z.infer<typeof GetPaperInputSchema>;
export type MetricsInput = z.infer<typeof MetricsInputSchema>;
export type CitationsInput = z.infer<typeof CitationsInputSchema>;
export type ExportInput = z.infer<typeof ExportInputSchema>;

// Library Management Types
export enum LibraryPermission {
  OWNER = 'owner',
  ADMIN = 'admin',
  WRITE = 'write',
  READ = 'read'
}

export enum LibraryType {
  ALL = 'all',
  OWNER = 'owner',
  COLLABORATOR = 'collaborator'
}

export enum LibraryOperation {
  UNION = 'union',
  INTERSECTION = 'intersection',
  DIFFERENCE = 'difference',
  COPY = 'copy',
  EMPTY = 'empty'
}

export enum DocumentAction {
  ADD = 'add',
  REMOVE = 'remove'
}

// Get Libraries
export const GetLibrariesInputSchema = z.object({
  type: z.nativeEnum(LibraryType).default(LibraryType.ALL).describe('Filter by library type'),
  response_format: z.nativeEnum(ResponseFormat).default(ResponseFormat.MARKDOWN)
});

// Get Library
export const GetLibraryInputSchema = z.object({
  library_id: z.string().min(1).describe('Library identifier'),
  response_format: z.nativeEnum(ResponseFormat).default(ResponseFormat.MARKDOWN)
});

// Create Library
export const CreateLibraryInputSchema = z.object({
  name: z.string().min(1).max(255).describe('Library name'),
  description: z.string().max(1000).optional().describe('Library description'),
  public: z.boolean().default(false).describe('Whether library is public'),
  bibcodes: z.array(z.string()).optional().describe('Initial bibcodes to add'),
  response_format: z.nativeEnum(ResponseFormat).default(ResponseFormat.MARKDOWN)
});

// Delete Library
export const DeleteLibraryInputSchema = z.object({
  library_id: z.string().min(1).describe('Library identifier'),
  response_format: z.nativeEnum(ResponseFormat).default(ResponseFormat.MARKDOWN)
});

// Edit Library Metadata
export const EditLibraryInputSchema = z.object({
  library_id: z.string().min(1).describe('Library identifier'),
  name: z.string().min(1).max(255).optional().describe('New library name'),
  description: z.string().max(1000).optional().describe('New library description'),
  public: z.boolean().optional().describe('Whether library is public'),
  response_format: z.nativeEnum(ResponseFormat).default(ResponseFormat.MARKDOWN)
});

// Add/Remove Documents
export const ManageDocumentsInputSchema = z.object({
  library_id: z.string().min(1).describe('Library identifier'),
  bibcodes: z.array(z.string()).min(1).max(2000).describe('List of bibcodes'),
  action: z.nativeEnum(DocumentAction).describe('Action to perform (add or remove)'),
  response_format: z.nativeEnum(ResponseFormat).default(ResponseFormat.MARKDOWN)
});

// Add Documents by Query
export const AddDocumentsByQueryInputSchema = z.object({
  library_id: z.string().min(1).describe('Library identifier'),
  query: z.string().min(1).describe('SciX search query'),
  rows: z.number().int().min(1).max(2000).default(25).describe('Number of results to add'),
  response_format: z.nativeEnum(ResponseFormat).default(ResponseFormat.MARKDOWN)
});

// Library Operation
export const LibraryOperationInputSchema = z.object({
  library_id: z.string().min(1).describe('Target library identifier'),
  operation: z.nativeEnum(LibraryOperation).describe('Operation to perform'),
  source_library_ids: z.array(z.string()).optional().describe('Source library IDs for union/intersection/difference'),
  name: z.string().optional().describe('Name for new library (for copy operation)'),
  description: z.string().optional().describe('Description for new library (for copy operation)'),
  response_format: z.nativeEnum(ResponseFormat).default(ResponseFormat.MARKDOWN)
});

// Get Permissions
export const GetPermissionsInputSchema = z.object({
  library_id: z.string().min(1).describe('Library identifier'),
  response_format: z.nativeEnum(ResponseFormat).default(ResponseFormat.MARKDOWN)
});

// Update Permissions
export const UpdatePermissionsInputSchema = z.object({
  library_id: z.string().min(1).describe('Library identifier'),
  email: z.string().email().describe('User email to grant/modify permissions'),
  permission: z.nativeEnum(LibraryPermission).describe('Permission level to grant'),
  response_format: z.nativeEnum(ResponseFormat).default(ResponseFormat.MARKDOWN)
});

// Transfer Library
export const TransferLibraryInputSchema = z.object({
  library_id: z.string().min(1).describe('Library identifier'),
  email: z.string().email().describe('Email of new owner'),
  response_format: z.nativeEnum(ResponseFormat).default(ResponseFormat.MARKDOWN)
});

// Get Annotation
export const GetAnnotationInputSchema = z.object({
  library_id: z.string().min(1).describe('Library identifier'),
  bibcode: z.string().min(1).describe('Bibcode to get annotation for'),
  response_format: z.nativeEnum(ResponseFormat).default(ResponseFormat.MARKDOWN)
});

// Add/Update Annotation
export const ManageAnnotationInputSchema = z.object({
  library_id: z.string().min(1).describe('Library identifier'),
  bibcode: z.string().min(1).describe('Bibcode to annotate'),
  content: z.string().min(1).max(10000).describe('Annotation content'),
  response_format: z.nativeEnum(ResponseFormat).default(ResponseFormat.MARKDOWN)
});

// Delete Annotation
export const DeleteAnnotationInputSchema = z.object({
  library_id: z.string().min(1).describe('Library identifier'),
  bibcode: z.string().min(1).describe('Bibcode to remove annotation from'),
  response_format: z.nativeEnum(ResponseFormat).default(ResponseFormat.MARKDOWN)
});

export type GetLibrariesInput = z.infer<typeof GetLibrariesInputSchema>;
export type GetLibraryInput = z.infer<typeof GetLibraryInputSchema>;
export type CreateLibraryInput = z.infer<typeof CreateLibraryInputSchema>;
export type DeleteLibraryInput = z.infer<typeof DeleteLibraryInputSchema>;
export type EditLibraryInput = z.infer<typeof EditLibraryInputSchema>;
export type ManageDocumentsInput = z.infer<typeof ManageDocumentsInputSchema>;
export type AddDocumentsByQueryInput = z.infer<typeof AddDocumentsByQueryInputSchema>;
export type LibraryOperationInput = z.infer<typeof LibraryOperationInputSchema>;
export type GetPermissionsInput = z.infer<typeof GetPermissionsInputSchema>;
export type UpdatePermissionsInput = z.infer<typeof UpdatePermissionsInputSchema>;
export type TransferLibraryInput = z.infer<typeof TransferLibraryInputSchema>;
export type GetAnnotationInput = z.infer<typeof GetAnnotationInputSchema>;
export type ManageAnnotationInput = z.infer<typeof ManageAnnotationInputSchema>;
export type DeleteAnnotationInput = z.infer<typeof DeleteAnnotationInputSchema>;

// Search Documentation
export const SearchDocsInputSchema = z.object({
  query: z.string().min(1).max(500).describe('Natural language search query for documentation'),
  limit: z.number().int().min(1).max(20).default(5).describe('Maximum number of results to return'),
});

export type SearchDocsInput = z.infer<typeof SearchDocsInputSchema>;
