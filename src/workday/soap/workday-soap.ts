import { XMLParser } from 'fast-xml-parser';

/** Versão dos web services SOAP do Workday usada pela integração. */
export const WORKDAY_SOAP_VERSION = 'v45.0';

/** Corpo SOAP já interpretado (sem prefixos de namespace). */
export type SoapNode = Record<string, unknown>;

/**
 * Erro de uma chamada SOAP do Workday: `fault` é a mensagem geral (ex.:
 * "Validation error occurred.") e `messages` os detalhes de validação, já sem
 * repetição. A `message` do erro junta os dois, para ir direto ao log.
 */
export class WorkdaySoapError extends Error {
  constructor(
    readonly operation: string,
    readonly status: number,
    readonly fault: string,
    readonly messages: string[],
  ) {
    super(
      `Workday ${operation}: ${messages.length ? messages.join(' | ') : fault}`,
    );
    this.name = 'WorkdaySoapError';
  }
}

/** Escapa um valor para entrar no XML (texto ou atributo). */
export function xmlEscape(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Monta um elemento simples `<wd:Nome>valor</wd:Nome>`, com o valor escapado.
 * Valores `null`/`undefined` não geram elemento.
 */
export function el(name: string, value: unknown): string {
  if (value === undefined || value === null) return '';
  return `<wd:${name}>${xmlEscape(value)}</wd:${name}>`;
}

/** Monta uma referência `<wd:Nome><wd:ID wd:type="tipo">id</wd:ID></wd:Nome>`. */
export function ref(name: string, idType: string, id: unknown): string {
  return `<wd:${name}><wd:ID wd:type="${xmlEscape(idType)}">${xmlEscape(id)}</wd:ID></wd:${name}>`;
}

/** Envelope SOAP com o corpo informado (o corpo já deve vir escapado). */
export function soapEnvelope(body: string): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wd="urn:com.workday/bsvc">' +
    `<soapenv:Body>${body}</soapenv:Body></soapenv:Envelope>`
  );
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
});

/**
 * Interpreta a resposta SOAP. Devolve o `Body` ou lança `WorkdaySoapError` se
 * houver `Fault` (o Workday responde 500 com o fault em erros de validação e
 * de permissão).
 */
export function parseSoapResponse(
  operation: string,
  status: number,
  text: string,
): SoapNode {
  let doc: SoapNode;
  try {
    doc = parser.parse(text) as SoapNode;
  } catch {
    throw new WorkdaySoapError(
      operation,
      status,
      `resposta não é XML (HTTP ${status}): ${text.slice(0, 200)}`,
      [],
    );
  }
  const envelope = (doc.Envelope ?? {}) as SoapNode;
  const body = (envelope.Body ?? {}) as SoapNode;
  const fault = body.Fault as SoapNode | undefined;
  if (fault) {
    const faultString = String(fault.faultstring ?? 'SOAP fault');
    const messages = [
      ...new Set(
        collectText(fault, 'Message').concat(
          collectText(fault, 'Detail_Message'),
        ),
      ),
    ].filter((m) => m && m !== faultString);
    throw new WorkdaySoapError(operation, status, faultString, messages);
  }
  if (status >= 400 || !Object.keys(body).length) {
    throw new WorkdaySoapError(
      operation,
      status,
      `HTTP ${status} sem corpo SOAP: ${text.slice(0, 200)}`,
      [],
    );
  }
  return body;
}

/**
 * Procura, em qualquer profundidade, o primeiro `<ID type="...">` do tipo
 * informado (ex.: `WID`) e devolve o valor.
 */
export function findIdByType(node: unknown, idType: string): string | null {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findIdByType(item, idType);
      if (found) return found;
    }
    return null;
  }
  if (!node || typeof node !== 'object') return null;
  const obj = node as SoapNode;
  for (const [key, value] of Object.entries(obj)) {
    if (key === 'ID') {
      for (const id of Array.isArray(value) ? value : [value]) {
        if (
          id &&
          typeof id === 'object' &&
          (id as SoapNode)['@_type'] === idType
        ) {
          return String((id as SoapNode)['#text'] ?? '');
        }
      }
    }
    const found = findIdByType(value, idType);
    if (found) return found;
  }
  return null;
}

/** Todos os textos de elementos com o nome informado, em qualquer profundidade. */
function collectText(node: unknown, name: string): string[] {
  const out: string[] = [];
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== 'object') return;
    for (const [key, value] of Object.entries(n as SoapNode)) {
      if (key === name) {
        for (const v of Array.isArray(value) ? value : [value]) {
          const text =
            typeof v === 'object' && v !== null ? (v as SoapNode)['#text'] : v;
          if (text !== undefined && text !== null)
            out.push(String(text).trim());
        }
      } else {
        walk(value);
      }
    }
  };
  walk(node);
  return out;
}
