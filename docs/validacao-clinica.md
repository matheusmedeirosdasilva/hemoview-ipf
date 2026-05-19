# Validação Clínica

O aplicativo classifica amostras por regra objetiva, mas não fecha diagnóstico. A saída deve ser interpretada como triagem analítica e precisa ser validada com o contexto clínico, controle interno do laboratório, metodologia do equipamento e critérios do serviço.

Antes de usar em rotina:

- Validar se a unidade de plaquetas exportada pelo equipamento é `/uL` ou `10^3/uL`. O script tenta inferir automaticamente e normaliza para `/uL`.
- Conferir se o IPF exportado vem em porcentagem (`12.5`) ou fração (`0.125`). O script normaliza frações para porcentagem.
- Testar o resultado contra um conjunto retrospectivo autorizado.
- Registrar sensibilidade, especificidade, concordância e casos discordantes.
- Revisar os cortes em `config/rules.json` com o responsável técnico.
