import type { ConfigType } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { appConfig } from './config/config';

const SWAGGER_METADATA_MODULE_PATH = './metadata.js';
const PUBLIC_OPERATION_EXTENSION = 'x-public';
const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace', 'search'] as const;

type AppConfiguration = ConfigType<typeof appConfig>;
type SwaggerPluginMetadataFactory = () => Promise<Record<string, any>>;
type SwaggerOperation = {
  security?: Array<Record<string, string[]>>;
  [PUBLIC_OPERATION_EXTENSION]?: boolean;
};
type SwaggerPathItem = OpenAPIObject['paths'][string] & Record<string, SwaggerOperation | unknown>;

export async function setupSwaggerDocs(app: NestFastifyApplication, config: AppConfiguration): Promise<void> {
  await loadSwaggerPluginMetadata();

  const openApiConfig = new DocumentBuilder()
    .setTitle('BookOrbit API')
    .setDescription('BookOrbit server API')
    .setVersion(config.version)
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'bearer')
    .build();

  const documentFactory = () => normalizeSwaggerDocument(SwaggerModule.createDocument(app, openApiConfig));

  SwaggerModule.setup('api/docs', app, documentFactory, {
    customSiteTitle: 'BookOrbit API Docs',
    jsonDocumentUrl: 'api/docs-json',
    raw: ['json'],
    swaggerOptions: {
      persistAuthorization: true,
    },
  });
}

export function normalizeSwaggerDocument(document: OpenAPIObject): OpenAPIObject {
  delete document.security;

  for (const pathItem of Object.values(document.paths)) {
    applyOperationSecurity(pathItem as SwaggerPathItem);
  }

  return document;
}

function applyOperationSecurity(pathItem: SwaggerPathItem): void {
  for (const method of HTTP_METHODS) {
    const operation = pathItem[method];
    if (!isSwaggerOperation(operation)) {
      continue;
    }

    operation.security = operation[PUBLIC_OPERATION_EXTENSION] === true ? [] : [{ bearer: [] }];
  }
}

function isSwaggerOperation(value: unknown): value is SwaggerOperation {
  return typeof value === 'object' && value !== null;
}

async function loadSwaggerPluginMetadata(): Promise<void> {
  try {
    const metadataModule = (await import(SWAGGER_METADATA_MODULE_PATH)) as { default?: SwaggerPluginMetadataFactory };
    if (typeof metadataModule.default === 'function') {
      await SwaggerModule.loadPluginMetadata(metadataModule.default);
    }
  } catch (err) {
    if (isMissingSwaggerMetadata(err)) {
      return;
    }
    throw err;
  }
}

function isMissingSwaggerMetadata(err: unknown): boolean {
  const code = typeof err === 'object' && err !== null && 'code' in err ? String((err as { code?: unknown }).code) : '';
  if (code !== 'ERR_MODULE_NOT_FOUND' && code !== 'MODULE_NOT_FOUND') {
    return false;
  }

  const message = err instanceof Error ? err.message : '';
  return message.includes('/metadata') || message.includes('\\metadata') || message.includes(SWAGGER_METADATA_MODULE_PATH);
}
