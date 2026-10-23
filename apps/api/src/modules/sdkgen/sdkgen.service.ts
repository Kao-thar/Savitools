import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { GenerateSdkDto } from './dto/generate-sdk.dto';
import {
  CodeGenerator,
  CurlGenerator,
  GoGenerator,
  PythonGenerator,
  TypeScriptGenerator,
  OpenApiSpec,
} from './generators';

/**
 * Bundled OpenAPI specs the service cannot serve `/sdkgen/generate` without.
 * `apps/api/nest-cli.json` copies `modules/sdkgen/specs` into `dist`, so they
 * sit next to the compiled service at runtime.
 */
export const REQUIRED_SPECS = ['fluxa', 'crowdpay'] as const;

@Injectable()
export class SdkgenService {
  private readonly logger = new Logger(SdkgenService.name);
  private specsCache: Record<string, OpenApiSpec> = {};
  private generators: Record<string, CodeGenerator> = {
    javascript: new TypeScriptGenerator(),
    typescript: new TypeScriptGenerator(),
    python: new PythonGenerator(),
    go: new GoGenerator(),
    curl: new CurlGenerator(),
  };

  constructor(
    @Optional()
    private readonly configService?: ConfigService,
  ) {
    for (const specName of REQUIRED_SPECS) {
      this.loadSpec(specName);
    }

    this.logger.log(`Loaded OpenAPI specs: ${this.loadedSpecs().join(', ')}`);
  }

  /** Names of the specs currently cached, in load order. */
  loadedSpecs(): string[] {
    return Object.keys(this.specsCache);
  }

  /**
   * Read one bundled spec, relative to the compiled module.
   *
   * A missing or malformed file is fatal rather than logged and swallowed: the
   * service is unusable without its specs, and swallowing the error let the
   * process boot "successfully" with an empty cache and fail as a 404 at
   * request time. Failing here turns a packaging mistake into a startup error.
   */
  private loadSpec(specName: string): void {
    const specPath = path.join(__dirname, 'specs', `${specName}.json`);
    try {
      const fileContent = fs.readFileSync(specPath, 'utf8');
      this.specsCache[specName] = JSON.parse(fileContent);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to load OpenAPI spec "${specName}" from ${specPath}: ${reason}. ` +
          'The specs are copied into dist by the "assets" entry in apps/api/nest-cli.json.',
      );
    }
  }

  generate(dto: GenerateSdkDto): string {
    const rawSpec = this.specsCache[dto.spec];
    if (!rawSpec) {
      throw new NotFoundException(`Spec ${dto.spec} not found`);
    }

    const generator = this.generators[dto.language.toLowerCase()];
    if (!generator) {
      throw new NotFoundException(`Language ${dto.language} is not supported`);
    }

    const spec = this.applyConfiguredBaseUrl(dto.spec, rawSpec);
    return generator.generate({ spec, endpoint: dto.endpoint });
  }

  private applyConfiguredBaseUrl(specName: string, spec: OpenApiSpec): OpenApiSpec {
    let overrideUrl: string | undefined;
    if (specName === 'crowdpay') {
      overrideUrl =
        this.configService?.get<string>('CROWDPAY_API_URL') || process.env.CROWDPAY_API_URL;
    } else if (specName === 'fluxa') {
      overrideUrl = this.configService?.get<string>('FLUXA_API_URL') || process.env.FLUXA_API_URL;
    }

    if (!overrideUrl) {
      return spec;
    }

    return {
      ...spec,
      servers: [{ url: overrideUrl.replace(/\/$/, '') }],
    };
  }
}
