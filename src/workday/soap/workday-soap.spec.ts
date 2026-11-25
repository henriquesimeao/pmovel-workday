import {
  el,
  findIdByType,
  parseSoapResponse,
  ref,
  WorkdaySoapError,
  xmlEscape,
} from './workday-soap';

const envelope = (body: string) =>
  `<?xml version="1.0" encoding="utf-8"?><env:Envelope xmlns:env="http://schemas.xmlsoap.org/soap/envelope/"><env:Body>${body}</env:Body></env:Envelope>`;

describe('workday-soap', () => {
  it('escapa valores no XML (texto e atributo)', () => {
    expect(xmlEscape(`a<b>&"c'`)).toBe('a&lt;b&gt;&amp;&quot;c&apos;');
    expect(el('Comment', '<x>')).toBe('<wd:Comment>&lt;x&gt;</wd:Comment>');
    expect(el('Comment', null)).toBe('');
    expect(ref('Worker_Reference', 'Employee_ID', 'a"b')).toBe(
      '<wd:Worker_Reference><wd:ID wd:type="Employee_ID">a&quot;b</wd:ID></wd:Worker_Reference>',
    );
  });

  it('devolve o Body e acha o WID da resposta', () => {
    const body = parseSoapResponse(
      'Submit_Payroll_Input',
      200,
      envelope(
        '<wd:Submit_Payroll_Input_Response xmlns:wd="urn:com.workday/bsvc"><wd:Payroll_Input_Reference><wd:ID wd:type="WID">abc123</wd:ID><wd:ID wd:type="Payroll_Input_ID">PMV-1</wd:ID></wd:Payroll_Input_Reference></wd:Submit_Payroll_Input_Response>',
      ),
    );
    expect(findIdByType(body, 'WID')).toBe('abc123');
    expect(findIdByType(body, 'Payroll_Input_ID')).toBe('PMV-1');
    expect(findIdByType(body, 'Outro')).toBeNull();
  });

  it('fault de validação vira WorkdaySoapError com as mensagens, sem repetir', () => {
    const text = envelope(
      `<env:Fault xmlns:wd="urn:com.workday/bsvc"><faultcode>env:Client.validationError</faultcode><faultstring>Validation error occurred. Invalid ID value.</faultstring><detail><wd:Validation_Fault><wd:Validation_Error><wd:Message>Invalid ID value.  'X' is not a valid ID value for type = 'Earning_Code'</wd:Message></wd:Validation_Error><wd:Validation_Error><wd:Message>Invalid ID value.  'X' is not a valid ID value for type = 'Earning_Code'</wd:Message></wd:Validation_Error></wd:Validation_Fault></detail></env:Fault>`,
    );
    let err: WorkdaySoapError | undefined;
    try {
      parseSoapResponse('Put_External_Payroll_Input', 500, text);
    } catch (e) {
      err = e as WorkdaySoapError;
    }
    expect(err).toBeInstanceOf(WorkdaySoapError);
    expect(err!.status).toBe(500);
    expect(err!.messages).toEqual([
      "Invalid ID value.  'X' is not a valid ID value for type = 'Earning_Code'",
    ]);
    expect(err!.message).toBe(
      "Workday Put_External_Payroll_Input: Invalid ID value.  'X' is not a valid ID value for type = 'Earning_Code'",
    );
  });

  it('fault de permissão usa o faultstring quando não há detalhe', () => {
    const text = envelope(
      '<env:Fault><faultcode>env:Server.processingError</faultcode><faultstring>Processing error occurred. The task submitted is not authorized.</faultstring></env:Fault>',
    );
    expect(() => parseSoapResponse('Get_X', 500, text)).toThrow(
      'Workday Get_X: Processing error occurred. The task submitted is not authorized.',
    );
  });

  it('resposta sem corpo SOAP vira erro', () => {
    expect(() => parseSoapResponse('Get_X', 502, 'Bad Gateway')).toThrow(
      WorkdaySoapError,
    );
  });
});
