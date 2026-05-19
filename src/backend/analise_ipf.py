#!/usr/bin/env python3
"""Analise local de exportacoes laboratoriais de plaquetas, VPM e IPF."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd
from scipy import stats


DEFAULT_COLUMNS = {
    "id": ["ID_Amostra", "ID Amostra", "Sample ID", "Amostra", "ID"],
    "platelets": ["Plaquetas_Global", "Plaquetas", "PLT", "PLT-I", "PLT-F"],
    "vpm": ["VPM", "MPV"],
    "ipf": ["IPF", "IPF%", "IPF %"],
}

DEFAULT_RULES = {
    "platelet_threshold_per_ul": 150000,
    "ipf_threshold_percent": 10.0,
    "classifications": {
        "peripheral_destruction": "Suspeita: Destruição Periférica",
        "reduced_production": "Suspeita: Produção Medular Reduzida",
        "no_thrombocytopenia": "Sem trombocitopenia pelo corte",
    },
}


def normalized_key(value: str) -> str:
    value = unicodedata.normalize("NFKD", str(value))
    value = "".join(char for char in value if not unicodedata.combining(char))
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def read_json_config(path: str | None, fallback: dict[str, Any]) -> dict[str, Any]:
    if not path:
        return fallback

    config_path = Path(path)
    if not config_path.exists():
        raise FileNotFoundError(f"Arquivo de configuracao nao encontrado: {config_path}")

    with config_path.open("r", encoding="utf-8") as file:
        loaded = json.load(file)

    merged = dict(fallback)
    for key, value in loaded.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = {**merged[key], **value}
        else:
            merged[key] = value
    return merged


def find_column(df: pd.DataFrame, aliases: list[str], logical_name: str) -> str:
    available = {normalized_key(column): column for column in df.columns}
    for alias in aliases:
        match = available.get(normalized_key(alias))
        if match:
            return match

    raise ValueError(
        f"Coluna obrigatoria nao encontrada para '{logical_name}'. "
        f"Candidatas aceitas: {', '.join(aliases)}. "
        f"Colunas no arquivo: {', '.join(map(str, df.columns))}"
    )


def parse_number(value: Any) -> float | None:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None

    if isinstance(value, int | float):
        return float(value)

    text = str(value).strip()
    if not text:
        return None

    text = text.replace("%", "").replace("\u00a0", " ")
    text = re.sub(r"[^0-9,.\-]", "", text)
    if not text or text in {"-", ".", ","}:
        return None

    comma = text.rfind(",")
    dot = text.rfind(".")
    if comma >= 0 and dot >= 0:
        if comma > dot:
            text = text.replace(".", "").replace(",", ".")
        else:
            text = text.replace(",", "")
    elif comma >= 0:
        digits_after = len(text) - comma - 1
        if digits_after == 3 and len(text[:comma]) <= 3:
            text = text.replace(",", "")
        else:
            text = text.replace(",", ".")

    try:
        return float(text)
    except ValueError:
        return None


def normalize_percent(series: pd.Series) -> pd.Series:
    numeric = series.map(parse_number).astype("float64")
    if numeric.dropna().empty:
        return numeric

    if numeric.quantile(0.95) <= 1.5:
        return numeric * 100
    return numeric


def normalize_platelets(series: pd.Series, unit: str) -> tuple[pd.Series, str]:
    numeric = series.map(parse_number).astype("float64")
    if numeric.dropna().empty:
        return numeric, "per_ul"

    selected_unit = unit
    if unit == "auto":
        selected_unit = "10e3_per_ul" if numeric.quantile(0.95) < 5000 else "per_ul"

    if selected_unit == "10e3_per_ul":
        return numeric * 1000, selected_unit

    if selected_unit != "per_ul":
        raise ValueError("Unidade de plaquetas invalida. Use auto, per_ul ou 10e3_per_ul.")

    return numeric, selected_unit


def anonymize_id(value: Any, row_number: int) -> str:
    base = str(value).strip() if value is not None else f"linha-{row_number}"
    digest = hashlib.sha256(base.encode("utf-8")).hexdigest()[:10].upper()
    return f"AMO-{digest}"


def classify_row(platelets: float | None, ipf: float | None, rules: dict[str, Any]) -> str:
    labels = rules["classifications"]
    platelet_threshold = float(rules["platelet_threshold_per_ul"])
    ipf_threshold = float(rules["ipf_threshold_percent"])

    if platelets is None or ipf is None or math.isnan(platelets) or math.isnan(ipf):
        return "Dados insuficientes"

    if platelets < platelet_threshold and ipf > ipf_threshold:
        return labels["peripheral_destruction"]
    if platelets < platelet_threshold:
        return labels["reduced_production"]
    return labels["no_thrombocytopenia"]


def pearson_correlation(vpm: pd.Series, ipf: pd.Series) -> dict[str, float | None]:
    pair = pd.DataFrame({"vpm": vpm, "ipf": ipf}).dropna()
    if len(pair) < 3:
        return {"r": None, "p_value": None, "n": int(len(pair))}

    result = stats.pearsonr(pair["vpm"], pair["ipf"])
    return {
        "r": round(float(result.statistic), 6),
        "p_value": round(float(result.pvalue), 6),
        "n": int(len(pair)),
    }


def analyze(args: argparse.Namespace) -> dict[str, Any]:
    csv_path = Path(args.csv_path)
    if not csv_path.exists():
        raise FileNotFoundError(f"Arquivo CSV nao encontrado: {csv_path}")

    columns_config = read_json_config(args.columns_config, DEFAULT_COLUMNS)
    rules = read_json_config(args.rules_config, DEFAULT_RULES)

    try:
        df = pd.read_csv(csv_path, sep=None, engine="python", encoding=args.encoding)
    except UnicodeDecodeError:
        df = pd.read_csv(csv_path, sep=None, engine="python", encoding="latin1")

    id_col = find_column(df, columns_config["id"], "id")
    platelet_col = find_column(df, columns_config["platelets"], "platelets")
    vpm_col = find_column(df, columns_config["vpm"], "vpm")
    ipf_col = find_column(df, columns_config["ipf"], "ipf")

    platelets, platelet_unit = normalize_platelets(df[platelet_col], args.platelet_unit)
    vpm = df[vpm_col].map(parse_number).astype("float64")
    ipf = normalize_percent(df[ipf_col])

    records: list[dict[str, Any]] = []
    for index, row in df.iterrows():
        row_number = int(index) + 2
        raw_id = row[id_col]
        sample_id = str(raw_id).strip() if args.keep_identifiers else anonymize_id(raw_id, row_number)

        platelet_value = platelets.iloc[index]
        vpm_value = vpm.iloc[index]
        ipf_value = ipf.iloc[index]
        classification = classify_row(platelet_value, ipf_value, rules)

        records.append(
            {
                "id_amostra": sample_id,
                "linha_origem": row_number,
                "plaquetas_global": None if pd.isna(platelet_value) else round(float(platelet_value), 2),
                "vpm": None if pd.isna(vpm_value) else round(float(vpm_value), 2),
                "ipf": None if pd.isna(ipf_value) else round(float(ipf_value), 2),
                "classificacao": classification,
            }
        )

    correlation = pearson_correlation(vpm, ipf)
    platelet_threshold = float(rules["platelet_threshold_per_ul"])
    ipf_threshold = float(rules["ipf_threshold_percent"])
    peripheral_label = rules["classifications"]["peripheral_destruction"]

    summary = {
        "total_amostras": len(records),
        "trombocitopenia": sum(
            1 for item in records if item["plaquetas_global"] is not None and item["plaquetas_global"] < platelet_threshold
        ),
        "suspeita_destruicao_periferica": sum(1 for item in records if item["classificacao"] == peripheral_label),
        "ids_pseudonimizados": not args.keep_identifiers,
        "unidade_plaquetas_normalizada": "por_uL",
        "unidade_plaquetas_detectada": platelet_unit,
    }

    return {
        "metadata": {
            "arquivo": csv_path.name,
            "gerado_em": datetime.now(timezone.utc).isoformat(),
            "colunas_usadas": {
                "id": id_col,
                "platelets": platelet_col,
                "vpm": vpm_col,
                "ipf": ipf_col,
            },
            "regras": {
                "platelet_threshold_per_ul": platelet_threshold,
                "ipf_threshold_percent": ipf_threshold,
            },
            "correlacao_vpm_ipf": correlation,
        },
        "summary": summary,
        "records": records,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Analisa plaquetas, VPM e IPF de um CSV real.")
    parser.add_argument("csv_path", help="Caminho para o CSV exportado pelo analisador.")
    parser.add_argument("--columns-config", help="JSON com aliases de colunas aceitos.")
    parser.add_argument("--rules-config", help="JSON com cortes e rotulos de classificacao.")
    parser.add_argument("--encoding", default="utf-8-sig", help="Encoding inicial de leitura do CSV.")
    parser.add_argument(
        "--platelet-unit",
        choices=["auto", "per_ul", "10e3_per_ul"],
        default="auto",
        help="Unidade da contagem de plaquetas no arquivo de entrada.",
    )
    parser.add_argument(
        "--keep-identifiers",
        action="store_true",
        help="Mantem IDs originais no JSON. Use apenas em ambiente autorizado.",
    )
    parser.add_argument("--output", help="Opcional: grava o JSON processado neste caminho.")
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    try:
        result = analyze(args)
        payload = json.dumps(result, ensure_ascii=False, indent=2)
        if args.output:
            Path(args.output).write_text(payload, encoding="utf-8")
        print(payload)
        return 0
    except Exception as exc:
        print(json.dumps({"erro": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
