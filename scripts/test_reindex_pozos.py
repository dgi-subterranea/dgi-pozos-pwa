#!/usr/bin/env python3
"""Tests para scripts/reindex_pozos.py - unittest de la libreria estandar,
sin dependencias externas (ejecutar con: python scripts/test_reindex_pozos.py
o python -m unittest scripts.test_reindex_pozos)."""
import json
import tempfile
import unittest
from pathlib import Path

import reindex_pozos as rp


# --- Normalizacion de valores individuales ---------------------------------

class NormalizeTextTests(unittest.TestCase):
    def test_blank_is_none(self):
        self.assertIsNone(rp.normalize_text('  '))

    def test_keeps_real_text_including_negative_looking_values(self):
        # "NO CEMENTADO" no debe tratarse como ausencia de dato por su
        # contenido - solo la cadena vacia es "sin dato".
        self.assertEqual(rp.normalize_text('NO CEMENTADO'), 'NO CEMENTADO')


class NormalizeQuotedTextTests(unittest.TestCase):
    def test_strips_quotes(self):
        self.assertEqual(rp.normalize_quoted_text("'0101220020000005'"), '0101220020000005')

    def test_empty_quotes_is_none(self):
        self.assertIsNone(rp.normalize_quoted_text("''"))

    def test_unquoted_passthrough(self):
        self.assertEqual(rp.normalize_quoted_text('ABC'), 'ABC')


class NormalizeDashTextTests(unittest.TestCase):
    def test_dash_is_none(self):
        self.assertIsNone(rp.normalize_dash_text('-'))

    def test_blank_is_none(self):
        self.assertIsNone(rp.normalize_dash_text(''))

    def test_real_value_kept(self):
        self.assertEqual(rp.normalize_dash_text('8663S-'), '8663S-')


class ParseNumberTests(unittest.TestCase):
    def test_thousands_and_decimal_comma(self):
        self.assertEqual(rp.parse_number('1.264,00'), 1264.0)

    def test_plain_decimal_comma(self):
        self.assertEqual(rp.parse_number('3,7454'), 3.7454)

    def test_negative(self):
        self.assertEqual(rp.parse_number('-101,5'), -101.5)

    def test_blank_is_none(self):
        self.assertIsNone(rp.parse_number(''))

    def test_garbage_is_none(self):
        self.assertIsNone(rp.parse_number('ATE'))


class CleanNumberTests(unittest.TestCase):
    def test_integral_float_becomes_int(self):
        self.assertEqual(rp.clean_number(220.0), 220)
        self.assertIsInstance(rp.clean_number(220.0), int)

    def test_non_integral_stays_float(self):
        self.assertEqual(rp.clean_number(3.5), 3.5)

    def test_none_passthrough(self):
        self.assertIsNone(rp.clean_number(None))


class NormalizeNumberZeroNullTests(unittest.TestCase):
    def test_zero_is_none(self):
        self.assertIsNone(rp.normalize_number_zero_null('0'))
        self.assertIsNone(rp.normalize_number_zero_null('0,00'))

    def test_real_value_kept(self):
        self.assertEqual(rp.normalize_number_zero_null('220'), 220)


class NormalizeBoolSiNoTests(unittest.TestCase):
    def test_si_true_no_false(self):
        self.assertTrue(rp.normalize_bool_si_no('SI'))
        self.assertFalse(rp.normalize_bool_si_no('NO'))

    def test_blank_is_none(self):
        self.assertIsNone(rp.normalize_bool_si_no(''))


class ParseFechaTests(unittest.TestCase):
    def test_parses_to_iso(self):
        self.assertEqual(rp.parse_fecha('24/9/1994'), '1994-09-24')

    def test_blank_is_none(self):
        self.assertIsNone(rp.parse_fecha(''))

    def test_garbage_is_none(self):
        self.assertIsNone(rp.parse_fecha('no es una fecha'))


class ParseAptitudTests(unittest.TestCase):
    def test_code_zero_is_undetermined(self):
        self.assertIsNone(rp.parse_aptitud('0-NO DETERMINADA.'))
        self.assertIsNone(rp.parse_aptitud('0-'))

    def test_real_code_keeps_readable_text(self):
        self.assertEqual(rp.parse_aptitud('5-APTA PARA RIEGO E INDUSTRIA.'), 'Apta para riego e industria')


class ParseTramoTests(unittest.TestCase):
    def test_empty_sentinel_is_none(self):
        self.assertIsNone(rp.parse_tramo('0,00-0,00 (Diam.0,00)'))

    def test_real_tramo(self):
        self.assertEqual(
            rp.parse_tramo('190,00-220,00 (Diam.8,00)'),
            {'desde': 190, 'hasta': 220, 'diametro': 8},
        )

    def test_unrecognized_format_is_none(self):
        self.assertIsNone(rp.parse_tramo('cualquier cosa'))


class ParseCementacionTests(unittest.TestCase):
    def test_desde_zero_is_real_when_hasta_is_also_real(self):
        # Caso verificado contra el CSV real: desde=0 con hasta>0 significa
        # "cementado desde la superficie", no sin-dato.
        result = rp.parse_cementacion('CEMENTADO', '0', '114')
        self.assertEqual(result, {'estado': 'CEMENTADO', 'desde': 0, 'hasta': 114})

    def test_desde_zero_is_null_when_block_fully_empty(self):
        result = rp.parse_cementacion('', '0', '0')
        self.assertIsNone(result)

    def test_desde_zero_is_null_when_hasta_also_zero_even_with_estado(self):
        # Caso real (01-0012): "NO CEMENTADO" con desde=0 Y hasta=0 - el
        # estado en si es un dato real y se conserva, pero desde=0 sin un
        # hasta real no tiene evidencia de ser una medicion (es el mismo
        # default generico que hasta=0 -> null).
        result = rp.parse_cementacion('NO CEMENTADO', '0', '0')
        self.assertEqual(result, {'estado': 'NO CEMENTADO', 'desde': None, 'hasta': None})

    def test_real_values_kept(self):
        result = rp.parse_cementacion('CEMENTADO', '28,5', '100')
        self.assertEqual(result, {'estado': 'CEMENTADO', 'desde': 28.5, 'hasta': 100})


class ParseCarbonatosTests(unittest.TestCase):
    def test_numeric_kept_as_string_is_not_forced(self):
        # No es un campo puramente numerico - se conserva texto de laboratorio.
        self.assertEqual(rp.parse_carbonatos('ATE'), 'ATE')
        self.assertEqual(rp.parse_carbonatos('AUSENTE'), 'AUSENTE')

    def test_zero_and_blank_are_none(self):
        self.assertIsNone(rp.parse_carbonatos(''))
        self.assertIsNone(rp.parse_carbonatos('0'))

    def test_numeric_value_kept_as_string(self):
        self.assertEqual(rp.parse_carbonatos('48'), '48')


class ParseCoordenadasTests(unittest.TestCase):
    def test_zero_is_none(self):
        self.assertIsNone(rp.parse_coordenadas('0', '0'))

    def test_real_values(self):
        self.assertEqual(
            rp.parse_coordenadas('2.530.577,69', '6.326.677,04'),
            {'x': 2530577.69, 'y': 6326677.04},
        )


class BuildWellIdTests(unittest.TestCase):
    def test_pads_department_and_pozo(self):
        row = [''] * 106
        row[rp.COL_COD_DEPARTAMENTO] = '1'
        row[rp.COL_NRO_POZO] = '12'
        self.assertEqual(rp.build_well_id(row), ('01-0012', 1))

    def test_non_numeric_is_none(self):
        row = [''] * 106
        row[rp.COL_COD_DEPARTAMENTO] = 'x'
        row[rp.COL_NRO_POZO] = '12'
        self.assertIsNone(rp.build_well_id(row))


class ParsePeriodoTests(unittest.TestCase):
    def test_extracts_month_year(self):
        warnings = []
        self.assertEqual(rp.parse_periodo_from_filename('Reporte Pozos 09_2026.csv', warnings), '2026-09')
        self.assertEqual(warnings, [])

    def test_unrecognized_filename_warns_and_returns_none(self):
        warnings = []
        self.assertIsNone(rp.parse_periodo_from_filename('reporte.csv', warnings))
        self.assertEqual(len(warnings), 1)


# --- Fixture de fila completa (106 columnas), por posicion ------------------

def make_row(overrides=None):
    overrides = overrides or {}
    row = [''] * 106
    defaults = {
        rp.COL_COD_DEPARTAMENTO: '1',
        rp.COL_NRO_POZO: '12',
        rp.COL_DEPARTAMENTO: 'CAPITAL',
        rp.COL_PERSONA: 'TITULAR DE PRUEBA',
        rp.COL_EXPEDIENTE: '12345-1999',
        rp.COL_FECHA_EJECUCION: '1/1/2000',
        rp.COL_DISTRITO: 'CIUDAD',
        rp.COL_DECL_JURADA: 'NO',
        rp.COL_USO: 'Agricola',
        rp.COL_NOMENCLATURA: "'0000000000000000'",
        rp.COL_ESTADO: 'Activo',
        rp.COL_REGISTRO_PERFORACION: '1',
        rp.COL_PLANO_DGI: '-',
        rp.COL_PERFILAJE: 'Si',
        rp.COL_RIEGO_SUPERFICIAL: 'No',
        rp.COL_APTITUD: '0-NO DETERMINADA.',
        rp.COL_FILTRO_1: '0,00-0,00 (Diam.0,00)',
        rp.COL_FILTRO_2: '0,00-0,00 (Diam.0,00)',
        rp.COL_FILTRO_3: '0,00-0,00 (Diam.0,00)',
        rp.COL_FILTRO_4: '0,00-0,00 (Diam.0,00)',
        rp.COL_FILTRO_5: '0,00-0,00 (Diam.0,00)',
        rp.COL_REDUCCION_1: '0,00-0,00 (Diam.0,00)',
        rp.COL_REDUCCION_2: '0,00-0,00 (Diam.0,00)',
        rp.COL_REDUCCION_3: '0,00-0,00 (Diam.0,00)',
    }
    for i, v in defaults.items():
        row[i] = v
    for i, v in overrides.items():
        row[i] = v
    return row


# HEADER de fixture: solo las posiciones que validate_header() chequea
# necesitan el texto exacto (son ASCII); el resto no se usa por nombre en
# ningun lado del pipeline (las columnas se leen por posicion), asi que
# alcanza con placeholders para no arriesgar transcribir mal las que
# llevan tilde.
def make_header():
    header = [f'col{i}' for i in range(106)]
    for pos, name in rp.HEADER_SENTINELS.items():
        header[pos] = name
    return header


class ValidateHeaderTests(unittest.TestCase):
    def test_valid_header_passes(self):
        rp.validate_header(make_header())  # no debe lanzar

    def test_wrong_length_raises(self):
        with self.assertRaises(rp.HeaderMismatch):
            rp.validate_header(make_header()[:-1])

    def test_reordered_sentinel_raises(self):
        header = make_header()
        header[20] = 'OtraCosa'
        with self.assertRaises(rp.HeaderMismatch):
            rp.validate_header(header)


class DedupeExactRowsTests(unittest.TestCase):
    def test_removes_byte_identical_rows(self):
        row = make_row()
        rows, removed = rp.dedupe_exact_rows([row, list(row)])
        self.assertEqual(len(rows), 1)
        self.assertEqual(removed, 1)

    def test_keeps_rows_that_differ(self):
        row_a = make_row({rp.COL_LABORATORIO: 'Lab A'})
        row_b = make_row({rp.COL_LABORATORIO: 'Lab B'})
        rows, removed = rp.dedupe_exact_rows([row_a, row_b])
        self.assertEqual(len(rows), 2)
        self.assertEqual(removed, 0)


class GroupRowsByWellIdTests(unittest.TestCase):
    def test_skips_department_out_of_range(self):
        warnings = []
        row = make_row({rp.COL_COD_DEPARTAMENTO: '99'})
        groups = rp.group_rows_by_well_id([row], warnings)
        self.assertEqual(groups, {})
        self.assertEqual(len(warnings), 1)

    def test_skips_non_numeric_ids(self):
        warnings = []
        row = make_row({rp.COL_NRO_POZO: 'abc'})
        groups = rp.group_rows_by_well_id([row], warnings)
        self.assertEqual(groups, {})
        self.assertEqual(len(warnings), 1)


class BuildRecordsTests(unittest.TestCase):
    def test_single_row_no_analysis(self):
        warnings = []
        row = make_row()
        groups = {'01-0012': [row]}
        records, multi = rp.build_records(groups, warnings)
        self.assertEqual(records['01-0012']['laboratorio']['analisis'], [])
        self.assertEqual(multi, 0)

    def test_merges_two_distinct_analyses(self):
        warnings = []
        row_a = make_row({rp.COL_LABORATORIO: 'ASSENZA', rp.COL_VALOR_PH: '7,56'})
        row_b = make_row({rp.COL_LABORATORIO: 'Agroas', rp.COL_VALOR_PH: '7,1'})
        groups = {'01-0012': [row_a, row_b]}
        records, multi = rp.build_records(groups, warnings)
        analisis = records['01-0012']['laboratorio']['analisis']
        self.assertEqual(len(analisis), 2)
        labs = sorted(a['laboratorio'] for a in analisis)
        self.assertEqual(labs, ['ASSENZA', 'Agroas'])
        self.assertEqual(multi, 1)

    def test_warns_when_non_lab_fields_differ_but_still_produces_a_record(self):
        warnings = []
        row_a = make_row({rp.COL_PERSONA: 'TITULAR A'})
        row_b = make_row({rp.COL_PERSONA: 'TITULAR B'})
        groups = {'01-0012': [row_a, row_b]}
        records, _ = rp.build_records(groups, warnings)
        self.assertEqual(records['01-0012']['titularidad']['titular'], 'TITULAR A')
        self.assertTrue(any('difieren en campos no-laboratorio' in w for w in warnings))

    def test_identical_analysis_rows_not_duplicated(self):
        warnings = []
        row = make_row({rp.COL_LABORATORIO: 'Lab X', rp.COL_VALOR_PH: '7'})
        groups = {'01-0012': [row, list(row)]}
        records, _ = rp.build_records(groups, warnings)
        self.assertEqual(len(records['01-0012']['laboratorio']['analisis']), 1)


# --- End-to-end sobre un CSV chico en disco ---------------------------------

class ReindexEndToEndTests(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmpdir.cleanup)

    def _write_csv(self, rows):
        csv_path = Path(self.tmpdir.name) / 'Reporte Pozos 09_2026.csv'
        header = make_header()
        lines = [';'.join(header)]
        for row in rows:
            lines.append(';'.join(row))
        content = '\r\n'.join(lines) + '\r\n'
        csv_path.write_bytes(content.encode('ISO-8859-1'))
        return csv_path

    def test_always_writes_19_department_files(self):
        csv_path = self._write_csv([make_row()])
        out_dir = Path(self.tmpdir.name) / 'out'
        rp.reindex(str(csv_path), str(out_dir))

        for dep in range(1, 20):
            dep_file = out_dir / f'{dep:02d}.json'
            self.assertTrue(dep_file.exists(), f'falta {dep_file.name}')
            with open(dep_file, encoding='utf-8') as f:
                data = json.load(f)
            if dep == 1:
                self.assertIn('01-0012', data)
            else:
                self.assertEqual(data, {})

    def test_metadata_shape(self):
        csv_path = self._write_csv([
            make_row(),
            make_row({rp.COL_COD_DEPARTAMENTO: '1', rp.COL_NRO_POZO: '13'}),
        ])
        out_dir = Path(self.tmpdir.name) / 'out'
        metadata, warnings = rp.reindex(str(csv_path), str(out_dir))

        self.assertEqual(metadata['pozosUnicos'], 2)
        self.assertEqual(metadata['fuente']['archivo'], 'Reporte Pozos 09_2026.csv')
        self.assertEqual(metadata['fuente']['periodo'], '2026-09')
        self.assertEqual(metadata['fuente']['filasFuente'], 2)
        self.assertEqual(metadata['departamentos']['01'], 2)
        self.assertEqual(metadata['departamentos']['02'], 0)
        self.assertIn('generadoEl', metadata)

    def test_exact_duplicate_removed_end_to_end(self):
        row = make_row()
        csv_path = self._write_csv([row, list(row)])
        out_dir = Path(self.tmpdir.name) / 'out'
        metadata, _ = rp.reindex(str(csv_path), str(out_dir))
        self.assertEqual(metadata['pozosUnicos'], 1)
        self.assertEqual(metadata['duplicadosExactosEliminados'], 1)

    def test_header_mismatch_raises(self):
        csv_path = Path(self.tmpdir.name) / 'bad.csv'
        csv_path.write_bytes('a;b;c\r\n1;2;3\r\n'.encode('ISO-8859-1'))
        with self.assertRaises(rp.HeaderMismatch):
            rp.reindex(str(csv_path), str(Path(self.tmpdir.name) / 'out'))


if __name__ == '__main__':
    unittest.main()
