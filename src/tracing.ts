import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { trace, Span, context, SpanStatusCode, Tracer } from '@opentelemetry/api';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import * as dotenv from 'dotenv';
import { logger } from './logger.js';
import { DEBUG } from './config.js';

// Load environment variables from .local.env
dotenv.config({ path: '.local.env' });

// Configuration for OTEL endpoint - can be overridden with env var
const OTLP_ENDPOINT = process.env.OTLP_ENDPOINT || 'http://localhost:4318';

interface TracingSetup {
  sdk: NodeSDK;
  tracer: Tracer;
}

export async function initializeTracing(serviceName: string, version: string): Promise<TracingSetup> {
  // Configure headers for Weave if W&B credentials are provided
  const headers: Record<string, string> = {};
  
  logger.debug('WANDB_API_KEY:', process.env.WANDB_API_KEY ? 'SET' : 'NOT SET');
  logger.debug('WANDB_PROJECT_ID:', process.env.WANDB_PROJECT_ID);
  
  if (process.env.WANDB_API_KEY && process.env.WANDB_PROJECT_ID) {
    // Base64 encode the API key for Basic auth
    const encodedApiKey = Buffer.from(`api:${process.env.WANDB_API_KEY}`).toString('base64');
    headers['Authorization'] = `Basic ${encodedApiKey}`;
    headers['project_id'] = process.env.WANDB_PROJECT_ID;
    logger.debug('Weave headers configured:', { project_id: headers['project_id'] });
  } else {
    logger.debug('Weave headers NOT configured - missing API key or project ID');
  }

  const otlpExporter = new OTLPTraceExporter({
    url: `${OTLP_ENDPOINT}/v1/traces`,
    headers: headers,
  });

  const spanProcessors = [new SimpleSpanProcessor(otlpExporter)];

  // Only add console exporter if DEBUG is enabled
  if (DEBUG) {
    const { ConsoleSpanExporter } = await import('@opentelemetry/sdk-trace-base');
    const consoleExporter = new ConsoleSpanExporter();
    spanProcessors.push(new SimpleSpanProcessor(consoleExporter));
    logger.debug('Console span exporter enabled');
  }

  const sdk = new NodeSDK({
    serviceName: serviceName,
    autoDetectResources: false,
    spanProcessors: spanProcessors,
    instrumentations: [getNodeAutoInstrumentations()]
  });

  try {
    sdk.start();
    const hasWeaveHeaders = process.env.WANDB_API_KEY && process.env.WANDB_PROJECT_ID;
    const weaveInfo = hasWeaveHeaders ? ' (with Weave headers)' : '';
    logger.server(`OpenTelemetry SDK initialized for ${serviceName} - sending traces to ${OTLP_ENDPOINT}${weaveInfo}`);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Error initializing OpenTelemetry:', errorMessage);
  }

  process.on('SIGTERM', () => {
    sdk.shutdown()
      .then(() => logger.server('SDK shut down successfully'))
      .catch((error: unknown) => {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error('Error shutting down SDK:', errorMessage);
      })
      .finally(() => process.exit(0));
  });

  const tracer = trace.getTracer(serviceName, version);
  return { sdk, tracer };
}

export { trace, context, SpanStatusCode };
export type { Span };
