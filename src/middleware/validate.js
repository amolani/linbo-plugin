/**
 * LINBO Plugin - Validation Middleware
 * Zod schemas for request validation
 */

const { z } = require('zod');

// =============================================================================
// Common Schemas
// =============================================================================

const uuidSchema = z.string().uuid();

const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
});

const macAddressSchema = z.string().regex(
  /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/,
  'Invalid MAC address format (expected XX:XX:XX:XX:XX:XX)'
);

const ipAddressSchema = z.string().regex(
  /^((25[0-5]|(2[0-4]|1\d|[1-9]|)\d)\.?\b){4}$/,
  'Invalid IP address format'
);

// =============================================================================
// Auth Schemas
// =============================================================================

const loginSchema = z.object({
  username: z.string().min(1, 'Username is required').max(255),
  password: z.string().min(1, 'Password is required').max(256),
});

// =============================================================================
// Host Schemas
// =============================================================================

const createHostSchema = z.object({
  hostname: z.string().min(1).max(15, 'Hostname darf maximal 15 Zeichen lang sein (Windows NetBIOS-Limit)').regex(/^[a-zA-Z0-9][a-zA-Z0-9-]*$/,
    'Hostname darf nur Buchstaben, Ziffern und Bindestriche enthalten und muss mit Buchstabe/Ziffer beginnen'),
  macAddress: macAddressSchema,
  ipAddress: ipAddressSchema.optional(),
  roomId: uuidSchema.optional().nullable(),
  configId: uuidSchema.optional().nullable(),
  status: z.enum(['online', 'offline', 'syncing', 'error']).default('offline'),
  bootMode: z.string().max(50).optional(),
  hardware: z.record(z.any()).optional(),
  metadata: z.record(z.any()).optional(),
});

const updateHostSchema = createHostSchema.partial();

const hostQuerySchema = paginationSchema.extend({
  roomId: uuidSchema.optional(),
  configId: uuidSchema.optional(),
  status: z.enum(['online', 'offline', 'syncing', 'error']).optional(),
  search: z.string().optional(),
});

// =============================================================================
// Room Schemas
// =============================================================================

const createRoomSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  location: z.string().max(255).optional(),
});

const updateRoomSchema = createRoomSchema.partial();

// =============================================================================
// Config Schemas
// =============================================================================

const partitionSchema = z.object({
  position: z.number().int().min(0),
  device: z.string().max(50),
  label: z.string().max(255).nullable().optional(),
  size: z.string().max(50).nullable().optional(),
  partitionId: z.string().max(10).regex(/^[0-9a-fA-F]+$/, 'Hex-Wert erwartet').nullable().optional(),
  fsType: z.string().max(50).nullable().optional(),
  bootable: z.boolean().default(false),
});

// Helper to coerce null to empty string for optional string fields
const nullableString = (maxLen = 255) => z.preprocess(
  (val) => (val === null ? '' : val),
  z.string().max(maxLen).optional()
);

const osSchema = z.object({
  position: z.number().int().min(0),
  name: z.string().min(1).max(255),
  version: nullableString(50),
  description: nullableString(1000),
  osType: nullableString(50),
  iconName: nullableString(255),
  image: nullableString(255),
  baseImage: nullableString(255),
  differentialImage: nullableString(255),
  rootDevice: nullableString(50),
  root: nullableString(50),
  kernel: nullableString(255),
  initrd: nullableString(255),
  append: z.preprocess(
    (val) => (val === null ? [] : val),
    z.union([z.array(z.string()), z.string()]).default([])
  ),
  startEnabled: z.boolean().default(true),
  syncEnabled: z.boolean().default(true),
  newEnabled: z.boolean().default(true),
  autostart: z.boolean().default(false),
  autostartTimeout: z.number().int().min(0).default(0),
  defaultAction: nullableString(50),
  restoreOpsiState: z.boolean().default(false),
  forceOpsiSetup: nullableString(255),
  hidden: z.boolean().default(false),
  prestartScript: nullableString(10000),
  postsyncScript: nullableString(10000),
});

const createConfigSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  version: z.string().max(50).default('1.0.0'),
  status: z.enum(['draft', 'active', 'archived']).default('draft'),
  patchclass: z.string().max(100).nullable().optional(), // Legacy field name, kept for API compatibility
  linboSettings: z.record(z.any()).default({}),
  partitions: z.array(partitionSchema).optional(),
  osEntries: z.array(osSchema).optional(),
});

const updateConfigSchema = createConfigSchema.partial();

// =============================================================================
// Image Schemas
// =============================================================================

const createImageSchema = z.object({
  filename: z.string().min(1).max(255),
  type: z.enum(['base', 'differential', 'torrent']),
  path: z.string().max(1024).optional(),
  size: z.number().optional(),
  checksum: z.string().max(64).optional(),
  backingImage: z.string().max(255).optional(),
  description: z.string().optional(),
  status: z.enum(['available', 'uploading', 'error']).default('available'),
});

const updateImageSchema = createImageSchema.partial().omit({ filename: true });

// =============================================================================
// Operation Schemas
// =============================================================================

const createOperationSchema = z.object({
  targetHosts: z.array(uuidSchema).min(1, 'At least one target host required'),
  commands: z.array(z.string()).min(1, 'At least one command required'),
  options: z.record(z.any()).default({}),
});

const sendCommandSchema = z.object({
  targetHosts: z.array(uuidSchema).min(1),
  command: z.enum(['sync', 'start', 'reboot', 'shutdown', 'wake']),
  osName: z.string().optional(), // For start command
  forceNew: z.boolean().default(false), // For sync command
});

// =============================================================================
// DHCP Schemas
// =============================================================================

const networkSettingsSchema = z.object({
  dhcpServerIp: ipAddressSchema.optional(),
  serverIp: ipAddressSchema.optional(),
  subnet: ipAddressSchema.optional(),
  netmask: ipAddressSchema.optional(),
  gateway: ipAddressSchema.optional(),
  dns: z.string().max(255).optional(),
  domain: z.string().max(255).optional(),
  dhcpRangeStart: z.string().max(50).optional(),
  dhcpRangeEnd: z.string().max(50).optional(),
  defaultLeaseTime: z.coerce.number().int().min(60).max(604800).optional(),
  maxLeaseTime: z.coerce.number().int().min(60).max(604800).optional(),
});

const dhcpExportQuerySchema = z.object({
  format: z.enum(['text', 'file']).default('text'),
  configId: uuidSchema.optional(),
  roomId: uuidSchema.optional(),
  interface: z.string().regex(/^[a-zA-Z0-9._-]+$/).optional(),
  pxeOnly: z.preprocess(
    (val) => val === 'true' || val === true,
    z.boolean().default(false)
  ),
  includeHeader: z.preprocess(
    (val) => val !== 'false' && val !== false,
    z.boolean().default(true)
  ),
  includeSubnet: z.preprocess(
    (val) => val !== 'false' && val !== false,
    z.boolean().default(true)
  ),
});

// =============================================================================
// User Schemas
// =============================================================================

const createUserSchema = z.object({
  username: z.string().min(1).max(255),
  email: z.string().email().optional(),
  password: z.string().min(6),
  role: z.enum(['admin', 'operator', 'viewer']).default('viewer'),
});

const updateUserSchema = z.object({
  email: z.string().email().optional(),
  password: z.string().min(6).optional(),
  role: z.enum(['admin', 'operator', 'viewer']).optional(),
  active: z.boolean().optional(),
});

// =============================================================================
// Validation Middleware Factory
// =============================================================================

/**
 * Create validation middleware for request body
 * @param {z.ZodSchema} schema - Zod schema to validate against
 */
function validateBody(schema) {
  return (req, res, next) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Request validation failed',
            details: error.errors.map(e => ({
              field: e.path.join('.'),
              message: e.message,
            })),
          },
        });
      }
      next(error);
    }
  };
}

/**
 * Create validation middleware for query parameters
 * @param {z.ZodSchema} schema - Zod schema to validate against
 */
function validateQuery(schema) {
  return (req, res, next) => {
    try {
      req.query = schema.parse(req.query);
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Query validation failed',
            details: error.errors.map(e => ({
              field: e.path.join('.'),
              message: e.message,
            })),
          },
        });
      }
      next(error);
    }
  };
}

/**
 * Create validation middleware for URL parameters
 * @param {z.ZodSchema} schema - Zod schema to validate against
 */
function validateParams(schema) {
  return (req, res, next) => {
    try {
      req.params = schema.parse(req.params);
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Parameter validation failed',
            details: error.errors.map(e => ({
              field: e.path.join('.'),
              message: e.message,
            })),
          },
        });
      }
      next(error);
    }
  };
}

module.exports = {
  // Schemas
  uuidSchema,
  paginationSchema,
  macAddressSchema,
  ipAddressSchema,
  loginSchema,
  createHostSchema,
  updateHostSchema,
  hostQuerySchema,
  createRoomSchema,
  updateRoomSchema,
  partitionSchema,
  osSchema,
  createConfigSchema,
  updateConfigSchema,
  createImageSchema,
  updateImageSchema,
  createOperationSchema,
  sendCommandSchema,
  createUserSchema,
  updateUserSchema,
  networkSettingsSchema,
  dhcpExportQuerySchema,
  // Middleware factories
  validateBody,
  validateQuery,
  validateParams,
};
