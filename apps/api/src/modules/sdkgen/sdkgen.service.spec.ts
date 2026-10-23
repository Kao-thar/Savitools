import * as fs from 'fs';
import { CurlGenerator } from './generators/curl.generator';
import { GoGenerator } from './generators/go.generator';
import { PythonGenerator } from './generators/python.generator';
import { TypeScriptGenerator } from './generators/typescript.generator';
import { OpenApiSpec } from './generators/types';
import { SdkgenService } from './sdkgen.service';

jest.mock('fs');
const readFileSync = fs.readFileSync as unknown as jest.Mock;

const fullSpec: OpenApiSpec = {
  servers: [{ url: 'https://api.example.com' }],
  paths: {
    '/items/{id}': {
      get: {
        summary: 'Read item',
        parameters: [
          { name: 'id', in: 'path', example: 'item-1' },
          {
            name: 'include',
            in: 'query',
            schema: { type: 'string', example: 'details' },
          },
        ],
        responses: {
          '200': {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['id'],
                  properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        summary: 'Create item',
        requestBody: {
          content: {
            'application/json': {
              schema: { properties: { name: { type: 'string', example: 'widget' } } },
            },
          },
        },
      },
      put: {
        summary: 'Replace item',
        parameters: [{ name: 'id', in: 'path', example: 'item-1' }],
        requestBody: {
          content: {
            'application/json': {
              schema: { properties: { name: { type: 'string', example: 'widget' } } },
            },
          },
        },
        responses: {
          '200': {
            content: {
              'application/json': {
                schema: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      },
      patch: { summary: 'Patch item' },
      delete: { summary: 'Delete item' },
    },
  },
};

const escapingSpec: OpenApiSpec = {
  servers: [{ url: 'https://api.example.com' }],
  paths: {
    '/items/{id}': {
      get: {
        summary: 'Read',
        parameters: [{ name: 'id', in: 'path', example: 'a"b' }],
      },
      post: {
        summary: 'Create',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                properties: { note: { type: 'string', example: "a'b\\c" } },
              },
            },
          },
        },
      },
      put: { summary: 'Replace' },
      patch: { summary: 'Patch' },
      delete: { summary: 'Delete' },
    },
  },
};

describe('SDK generators', () => {
  const cases = [
    {
      name: 'TypeScript',
      generator: new TypeScriptGenerator(),
      credential: 'API_KEY',
      escaped: "a'b",
      methods: ['axios.get', 'axios.post', 'axios.put', 'axios.patch', 'axios.delete'],
      query: 'params: { "include": "details" }',
      responseType: 'interface GetItemsIdResponse',
      responseField: '"id": string;',
      arrayResponse: 'type PutItemsIdResponse = string[];',
    },
    {
      name: 'Python',
      generator: new PythonGenerator(),
      credential: 'API_KEY',
      escaped: "a\\'b",
      methods: [
        'requests.get',
        'requests.post',
        'requests.put',
        'requests.patch',
        'requests.delete',
      ],
      query: 'params={"include": "details"}',
      responseType: 'class GetItemsIdResponse(TypedDict',
      responseField: 'id: str',
      arrayResponse: 'PutItemsIdResponse = List[str]',
    },
    {
      name: 'Go',
      generator: new GoGenerator(),
      credential: 'os.Getenv("API_KEY")',
      escaped: "a'b",
      methods: [
        'http.NewRequest("GET"',
        'http.NewRequest("POST"',
        'http.NewRequest("PUT"',
        'http.NewRequest("PATCH"',
        'http.NewRequest("DELETE"',
      ],
      query: 'params.Set("include", "details")',
      responseType: 'type GetItemsIdResponse struct',
      responseField: 'Id string',
      arrayResponse: 'type PutItemsIdResponse []string',
    },
  ];

  it.each(cases)(
    'generates escaped $name source for every HTTP method',
    ({ generator, credential, escaped, methods }) => {
      const output = generator.generate({ spec: escapingSpec });
      expect(output).toContain(credential);
      for (const method of methods) expect(output).toContain(method);
      expect(output).toContain(escaped);
    },
  );

  it.each(cases)('includes query parameters in $name output', ({ generator, query }) => {
    expect(generator.generate({ spec: fullSpec })).toContain(query);
  });

  it.each(cases)(
    'infers response types in $name output',
    ({ generator, responseType, responseField, arrayResponse }) => {
      const output = generator.generate({ spec: fullSpec });
      expect(output).toContain(responseType);
      expect(output).toContain(responseField);
      expect(output).toContain(arrayResponse);
    },
  );

  it('never emits a hardcoded TODO fallback', () => {
    for (const { generator } of cases) {
      expect(generator.generate({ spec: fullSpec })).not.toContain('TODO');
    }
    expect(new CurlGenerator().generate({ spec: fullSpec })).not.toContain('TODO');
  });

  it('appends query parameters to cURL requests', () => {
    const output = new CurlGenerator().generate({ spec: fullSpec });
    expect(output).toContain('/items/item-1?include=details');
    expect(output).toContain('curl -X GET');
    expect(output).toContain('curl -X PUT');
  });
});

describe('SdkgenService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    readFileSync.mockReturnValue(
      JSON.stringify({
        openapi: '3.0.0',
        info: { title: 'Test API', version: '1.0.0' },
        paths: {
          '/test': {
            get: {
              summary: 'Test endpoint',
              responses: { '200': { description: 'OK' } },
            },
          },
        },
      }),
    );
  });

  it.each(['typescript', 'python', 'go', 'curl', 'javascript'])('generates %s code', (language) => {
    const service = new SdkgenService();
    expect(service.generate({ spec: 'fluxa', language, endpoint: '/test' })).toEqual(
      expect.any(String),
    );
  });

  it('throws for unknown spec and unsupported language', () => {
    const service = new SdkgenService();
    expect(() =>
      service.generate({
        spec: 'unknown' as 'fluxa',
        language: 'typescript',
        endpoint: '/test',
      }),
    ).toThrow('Spec unknown not found');
    expect(() => service.generate({ spec: 'fluxa', language: 'rust', endpoint: '/test' })).toThrow(
      'Language rust is not supported',
    );
  });

  it('reports which specs it loaded', () => {
    const service = new SdkgenService();

    expect(service.loadedSpecs()).toEqual(['fluxa', 'crowdpay']);
  });

  it('refuses to boot when a bundled spec cannot be read', () => {
    readFileSync.mockImplementation(() => {
      throw new Error('ENOENT: no such file or directory, open ...');
    });

    expect(() => new SdkgenService()).toThrow(/Failed to load OpenAPI spec "fluxa"/);
  });

  it('respects configured base URL from ConfigService (#405, #428)', () => {
    const mockConfig = {
      get: jest.fn((key: string) => {
        if (key === 'FLUXA_API_URL') return 'https://fluxa.custom.io';
        return undefined;
      }),
    } as any;

    const service = new SdkgenService(mockConfig);
    const code = service.generate({
      spec: 'fluxa',
      language: 'typescript',
      endpoint: '/test',
    });

    expect(code).toContain('https://fluxa.custom.io/test');
  });
});
