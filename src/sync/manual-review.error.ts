/**
 * Item que o integrador não consegue resolver sozinho e que precisa de uma
 * pessoa (ex.: e-mail ou CPF que já pertencem a outro cadastro no destino).
 *
 * O SyncOrchestrator reconhece este erro: o item continua sendo registrado como
 * falha em `sync_item`, mas com a marcação `TRATAMENTO MANUAL` na mensagem, e ao
 * fim da execução os itens assim marcados são listados juntos no log.
 */
export class ManualReviewError extends Error {
  static readonly MARKER = 'TRATAMENTO MANUAL';

  /**
   * @param externalId chave do item
   * @param reason motivo, em uma frase
   * @param details valores a destacar (ex.: e-mail e CPF), na ordem de exibição
   * @param hint o que a pessoa deve fazer
   */
  constructor(
    readonly externalId: string,
    readonly reason: string,
    readonly details: Record<string, string>,
    readonly hint?: string,
  ) {
    super(
      [
        ManualReviewError.MARKER,
        reason,
        ManualReviewError.formatDetails(details),
        ...(hint ? [`ação: ${hint}`] : []),
      ].join(' | '),
    );
    this.name = 'ManualReviewError';
  }

  /** `chave=valor | chave=valor`: os valores que a pessoa precisa procurar. */
  get highlight(): string {
    return ManualReviewError.formatDetails(this.details);
  }

  private static formatDetails(details: Record<string, string>): string {
    return Object.entries(details)
      .map(([key, value]) => `${key}=${value}`)
      .join(' | ');
  }
}
