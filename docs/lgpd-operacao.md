# Operação Com Dados Reais

Este projeto deve ser tratado como software que processa dado pessoal sensível quando o CSV permite identificar, direta ou indiretamente, uma pessoa. Dados referentes à saúde recebem proteção reforçada na LGPD.

Medidas práticas recomendadas:

- Confirmar com o encarregado de dados/DPO ou jurídico qual é a base legal aplicável ao tratamento.
- Usar apenas as colunas necessárias para a finalidade analítica: ID da amostra, plaquetas, VPM e IPF.
- Preferir pseudonimização na interface e guardar a chave de reidentificação fora do aplicativo.
- Rodar a análise localmente, sem upload de CSV para serviços externos.
- Restringir acesso ao computador, à pasta de dados e ao instalador.
- Definir prazo de retenção para CSVs importados e JSONs exportados.
- Registrar versão das regras usadas em validações clínicas e auditorias.

Referências oficiais úteis:

- LGPD no Ministério da Saúde: https://www.gov.br/saude/pt-br/acesso-a-informacao/lgpd
- Perguntas frequentes da ANPD sobre dados pessoais: https://www.gov.br/anpd/pt-br/acesso-a-informacao/perguntas-frequentes/perguntas-frequentes/2-dados-pessoais
- Lei nº 13.709/2018: https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm
