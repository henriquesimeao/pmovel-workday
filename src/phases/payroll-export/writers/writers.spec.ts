import { WorkdayClient } from '../../../workday/workday.client';
import { PayrollInputLine } from './payroll-input-writer';
import { SubmitPayrollInputWriter } from './submit-payroll-input.writer';
import { ExternalPayrollInputWriter } from './external-payroll-input.writer';

const line: PayrollInputLine = {
  inputId: 'PMV-456-282539-0020',
  batchId: 'PMV-123',
  externalId: '21411',
  code: '0020',
  type: 'P',
  hours: '3.50',
  startDate: '2026-05-15',
  endDate: '2026-06-14',
  currency: 'USD',
  comment: 'Pmovel: ciclo <teste>',
};

/** Posição de cada trecho no XML, para conferir a ordem do XSD. */
function order(xml: string, parts: string[]): number[] {
  return parts.map((p) => xml.indexOf(p));
}

describe('SubmitPayrollInputWriter (Workday Payroll)', () => {
  it('monta o request na ordem do XSD, com valores escapados', () => {
    const xml = SubmitPayrollInputWriter.buildRequest(line);
    const pos = order(xml, [
      '<wd:Payroll_Input_ID>PMV-456-282539-0020<',
      '<wd:Batch_ID>PMV-123<',
      '<wd:Start_Date>2026-05-15<',
      '<wd:End_Date>2026-06-14<',
      '<wd:Worker_Reference><wd:ID wd:type="Employee_ID">21411<',
      '<wd:Earning_Reference><wd:ID wd:type="Earning_Code">0020<',
      '<wd:Hours>3.50<',
      '<wd:Comment>Pmovel: ciclo &lt;teste&gt;<',
      '<wd:Currency_Reference><wd:ID wd:type="Currency_ID">USD<',
    ]);
    expect(pos.every((p) => p >= 0)).toBe(true);
    expect([...pos].sort((a, b) => a - b)).toEqual(pos);
  });

  it('desconto (D) usa Deduction_Reference; sem moeda, não envia moeda', () => {
    const xml = SubmitPayrollInputWriter.buildRequest({
      ...line,
      type: 'D',
      currency: null,
    });
    expect(xml).toContain(
      '<wd:Deduction_Reference><wd:ID wd:type="Deduction_Code">0020<',
    );
    expect(xml).not.toContain('Earning_Reference');
    expect(xml).not.toContain('Currency_Reference');
  });

  it('chama o serviço Payroll e devolve o WID', async () => {
    const callSoap = jest.fn().mockResolvedValue({
      Submit_Payroll_Input_Response: {
        Payroll_Input_Reference: {
          ID: [{ '#text': 'wid-1', '@_type': 'WID' }],
        },
      },
    });
    const writer = new SubmitPayrollInputWriter({
      callSoap,
    } as unknown as WorkdayClient);
    await expect(writer.upsert(line)).resolves.toEqual({ wid: 'wid-1' });
    expect(callSoap).toHaveBeenCalledWith(
      'Payroll',
      'Submit_Payroll_Input',
      expect.stringContaining('<wd:Submit_Payroll_Input_Request'),
    );
  });
});

describe('ExternalPayrollInputWriter (Payroll Interface)', () => {
  it('monta o request na ordem do XSD', () => {
    const xml = ExternalPayrollInputWriter.buildRequest(line);
    const pos = order(xml, [
      '<wd:Payroll_Input_ID>PMV-456-282539-0020<',
      '<wd:Payee_Reference><wd:ID wd:type="Employee_ID">21411<',
      '<wd:Pay_Component_Workday_Reference><wd:ID wd:type="Earning_Code">0020<',
      '<wd:Batch_ID>PMV-123<',
      '<wd:Start_Date>2026-05-15<',
      '<wd:End_Date>2026-06-14<',
      '<wd:Unit>3.50<',
      '<wd:Comment>',
      '<wd:Currency_Reference><wd:ID wd:type="Currency_ID">USD<',
    ]);
    expect(pos.every((p) => p >= 0)).toBe(true);
    expect([...pos].sort((a, b) => a - b)).toEqual(pos);
  });

  it('desconto (D) usa Deduction_Code', () => {
    expect(
      ExternalPayrollInputWriter.buildRequest({ ...line, type: 'D' }),
    ).toContain('<wd:ID wd:type="Deduction_Code">0020<');
  });

  it('recusa lançamento sem moeda (o Payroll Interface exige)', () => {
    expect(() =>
      ExternalPayrollInputWriter.buildRequest({ ...line, currency: null }),
    ).toThrow(/moeda obrigatória/);
  });

  it('chama o serviço Payroll_Interface', async () => {
    const callSoap = jest.fn().mockResolvedValue({});
    const writer = new ExternalPayrollInputWriter({
      callSoap,
    } as unknown as WorkdayClient);
    await expect(writer.upsert(line)).resolves.toEqual({ wid: null });
    expect(callSoap.mock.calls[0][0]).toBe('Payroll_Interface');
    expect(callSoap.mock.calls[0][1]).toBe('Put_External_Payroll_Input');
  });
});
