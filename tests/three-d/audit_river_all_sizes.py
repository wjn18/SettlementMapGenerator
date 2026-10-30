"""Independently reconcile river-size deliverables and saved-scene evidence.

Run after river-all-sizes.mjs has built, verified and photographed every case.
This process does not rewrite scenes or their structural verification reports.
The Blender verifier remains the authority for actual world-space geometry;
this additional audit proves that its evidence belongs to the delivered files.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import struct
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[2]
SIZES = (6, 12, 24, 40, 60, 80, 100)
TERRAINS = ('inland', 'estuary')
FILES = ('source-town.json', 'selection.json', 'scene-manifest.json', 'scene.blend')


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def failed_rows(value, path='report'):
    """Keep all detailed geometry failures visible, even under a pass wrapper."""
    result = []
    if isinstance(value, dict):
        if 'passed' in value and value['passed'] is not True:
            result.append(path)
        for key, item in value.items():
            result.extend(failed_rows(item, path + '.' + str(key)))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            result.extend(failed_rows(item, path + '[' + str(index) + ']'))
    return result


def audit_case(directory, terrain, size, images=True, require_tamper=False, current_fingerprints=None):
    errors = []
    def check(condition, message):
        if not condition:
            errors.append(message)
    report = read_json(directory / 'verification.json')
    source = read_json(directory / 'source-town.json')
    selection = read_json(directory / 'selection.json')
    manifest = read_json(directory / 'scene-manifest.json')
    source_hashes = {name: sha256(directory / name) for name in FILES}
    if current_fingerprints is not None:
        state = read_json(directory / 'matrix-state.json')
        case_result = read_json(directory / 'case-result.json')
        expected_state_fingerprints = {'build': 'scene', 'verify': 'verification'}
        if images:
            expected_state_fingerprints['render'] = 'rendering'
        check(case_result.get('fingerprint') == current_fingerprints, 'Case result was produced by different assembler/verifier/renderer dependencies.')
        allowed_files = set(FILES) | {'input.json', 'asset-integration.json', 'verification.json', 'city-center-render.png'}
        for stage, fingerprint_key in expected_state_fingerprints.items():
            record = state.get(stage, {})
            check(record.get('fingerprint') == current_fingerprints[fingerprint_key], stage + ': production dependency fingerprint is stale.')
            stage_hashes = record.get('hashes', {})
            check(bool(stage_hashes) and set(stage_hashes) <= allowed_files, stage + ': file evidence is empty or names an unexpected artifact.')
            for name, expected in stage_hashes.items():
                if name in allowed_files:
                    check(sha256(directory / name) == expected, stage + '/' + name + ': actual file SHA differs from the stage evidence.')
        check(state.get('build', {}).get('sourceHash') == state.get('prepare', {}).get('sourceHash') == case_result.get('sourceHash'), 'Build, planning and final case result reference different source snapshots.')
    check(report.get('status') == 'pass' and report.get('failures') == [], 'Structural verification did not pass cleanly.')
    check(report.get('sourceFilesSha256') == source_hashes, 'Structural report hashes differ from the delivered source/adapter/manifest/scene.')
    check(report.get('sceneFile') == 'scene.blend', 'Structural report names a different scene.')
    check(source.get('request', {}).get('size') == size == source.get('resolved', {}).get('size'), 'Source requested/resolved scale differs from this matrix case.')
    check(source.get('request', {}).get('river') is True and bool(source.get('river', {}).get('surface')), 'Source lacks a real planned river surface.')
    fortified = terrain == 'inland'
    check(source.get('resolved', {}).get('walls') is fortified and source.get('resolved', {}).get('castle') is fortified,
          'The matrix recipe changed its required wall/castle coverage.')
    check(selection.get('scope') == 'whole-city' and manifest.get('scope') == 'whole-city', 'A cropped selection cannot prove a full settlement.')
    check(source.get('river') == selection.get('river'), 'The adapter changed the source river or bridge planning.')
    check(source.get('terrain') == selection.get('terrain'), 'The adapter changed the source coastal planning.')
    check(report.get('sourceIntegrity', {}).get('passed') is True and report['sourceIntegrity'].get('checked') is True, 'Whole-source integrity was not established.')
    scale = manifest.get('horizontalScale')
    check(isinstance(scale, (float, int)) and math.isfinite(scale) and scale > 0 and scale == report.get('horizontalScale'), 'Scene/report coordinate scale is inconsistent.')
    check(manifest.get('source', {}).get('sha256') == source_hashes['source-town.json'], 'Manifest source SHA does not match the actual planning snapshot.')

    # Reconstruct selected entity points directly from the immutable source
    # vertex table, independently of the renderer and its manifest.
    vertices = {point['id']: {'x': point['x'], 'y': point['y']} for point in source['vertices']}
    for category, boundary in (('buildings', 'boundary'), ('districts', 'boundary'), ('roads', 'vertexIds'), ('walls', 'boundary'), ('features', 'boundary')):
        expected = {item['id']: item for item in source.get(category, [])}
        selected = selection.get(category, [])
        identifiers = [item.get('sourceId', item['id']) for item in selected]
        check(len(identifiers) == len(set(identifiers)) and set(identifiers) == set(expected), category + ': selected IDs are incomplete or duplicated.')
        for item, identifier in zip(selected, identifiers):
            original = expected.get(identifier)
            if original is None:
                continue
            check(item.get('points') == [vertices[vid] for vid in original[boundary]], category + '/' + identifier + ': selected coordinates changed.')
            keys = {'buildings': ('districtId',), 'districts': ('wardType', 'withinCity', 'withinWalls'),
                    'roads': ('kind', 'width'), 'walls': ('kind', 'activeSegments'), 'features': ('kind', 'districtId')}[category]
            check(all(item.get(key) == original.get(key) for key in keys), category + '/' + identifier + ': source semantic attributes changed.')
    for category in ('gates', 'entrances'):
        originals = source.get(category, [])
        selected = selection.get(category, [])
        selected_by_id = {item['id']: item for item in selected}
        expected_ids = {item['id'] if isinstance(item, dict) else item for item in originals}
        check(len(selected_by_id) == len(selected) and set(selected_by_id) == expected_ids, category + ': adapter omitted or duplicated source gates/entrances.')
        for original in originals:
            identifier = original['id'] if isinstance(original, dict) else original
            item = selected_by_id.get(identifier, {})
            if isinstance(original, dict):
                check(all(item.get(key) == value for key, value in original.items()), category + '/' + identifier + ': source attributes changed.')
                vertex_id = original['vertexId']
            else:
                vertex_id = original
            check(item.get('point') == vertices[vertex_id], category + '/' + identifier + ': source coordinate changed.')

    counts = report.get('counts', {})
    check(counts.get('expectedBuildings') == counts.get('actualBuildingFootprintObjects') == counts.get('verifiedBuildings') == len(source['buildings']), 'Building count is incomplete.')
    check(counts.get('verifiedRoads') == len(source['roads']), 'Road count is incomplete.')
    check(counts.get('verifiedSourceFeatures') == len(source.get('features', [])), 'Public feature count is incomplete.')
    active_walls = sum(sum(bool(flag) for flag in wall.get('activeSegments', [])) for wall in source.get('walls', []))
    check(counts.get('expectedActiveWallSegments') == len(report.get('wallCoverage', [])) == active_walls, 'Active wall coverage count differs from source.')
    check(counts.get('verifiedGateCenters') == len(source.get('gates', [])), 'Source gate center coverage is incomplete.')
    bridge_ids = {bridge['id'] for bridge in source['river'].get('bridges', [])}
    river = report.get('river', {})
    check(river.get('enabled') is True and river.get('passed') is True, 'River geometry was not verified.')
    check(counts.get('verifiedBridges') == river.get('verifiedBridges') == len(bridge_ids), 'Bridge count differs from the source river.')
    check({bridge.get('id') for bridge in river.get('bridges', [])} == bridge_ids, 'Bridge source IDs differ.')
    check(all(not bridge.get('blockers') and all(endpoint.get('passed') for endpoint in bridge.get('endpoints', [])) for bridge in river.get('bridges', [])), 'A bridge has a blocked walking corridor or disconnected bank approach.')
    river_checks = river.get('checks', [])
    kinds = {item.get('kind') for item in river_checks}
    check({'river_bank_shell', 'river_land_separation', 'river_bed'} <= kinds, 'River ground, bank shell or bed evidence is missing.')
    shells = [item for item in river_checks if item.get('kind') == 'river_bank_shell']
    check(bool(shells) and all(item.get('openEdgeCount') == item.get('invalidEdgeCount') == 0 for item in shells), 'River bank shell has bare or invalid geometric edges.')
    market_ids = {item['id'] for item in source.get('districts', []) if item.get('wardType') == 'Market'}
    markets = report.get('markets', {})
    check(markets.get('version') == 1 and markets.get('passed') is True, 'Current per-market verification did not pass.')
    check({item.get('id') for item in markets.get('plazas', [])} == market_ids and counts.get('verifiedMarkets') == len(market_ids), 'Some source markets were omitted or added.')
    check(not markets.get('crossMarketConflicts') and not markets.get('fortificationConflicts'), 'Actual market meshes intersect another market or fortification.')
    if active_walls and market_ids:
        check(markets.get('checkedFortificationObjects', 0) > 0, 'Fortified markets have no actual fortification mesh evidence.')
    check({item.get('id') for item in manifest.get('markets', {}).get('plazas', [])} == market_ids, 'Manifest source markets differ from the planning snapshot.')
    assets = report.get('assetIntegration', {})
    check(assets.get('enabled') is True and assets.get('passed') is True, 'Authored resource geometry was not verified.')
    check(assets.get('citizens', {}).get('passed') is True and not assets['citizens'].get('conflictingPairs'), 'Authored citizen mesh collision audit did not pass.')
    if terrain == 'estuary':
        check(bool(source.get('terrain', {}).get('coast')), 'Estuary case has no source coast.')
        check(source.get('request', {}).get('coast') == 'east' and source.get('request', {}).get('harbor') is True, 'The estuary matrix recipe changed its coast/harbor coverage.')
        check(report.get('estuary', {}).get('enabled') is True and report['estuary'].get('passed') is True, 'Combined river/sea geometry did not pass.')
        check(report.get('harbor', {}).get('enabled') is True and report['harbor'].get('passed') is True, 'Estuary harbor geometry did not pass.')
        harbor = report.get('harbor', {})
        check(harbor.get('verifiedDocks') == len(source.get('terrain', {}).get('docks', [])) > 0, 'Source harbor docks lack complete actual mesh evidence.')
        check(bool(harbor.get('boats')) and all(boat.get('dryInteriorPassed') is True and not boat.get('waterIntersections') and not boat.get('missingFloorProbes') for boat in harbor.get('boats', [])), 'Actual harbor boats are missing or lack dry cabin floors.')
    else:
        check(not source.get('terrain', {}).get('coast'), 'Inland case unexpectedly contains a coast.')
        check('river_water' in kinds, 'Inland source river surface coverage evidence is missing.')
    details = failed_rows(report)
    check(not details, 'Detailed failed rows are present: ' + ', '.join(details[:20]))

    png = None
    image = directory / 'city-center-render.png'
    if images:
        with image.open('rb') as stream:
            header = stream.read(24)
        check(header[:8] == b'\x89PNG\r\n\x1a\n' and header[12:16] == b'IHDR', 'Rendered image is not a PNG with dimensions.')
        if len(header) == 24:
            width, height = struct.unpack('>II', header[16:24])
            check(width == height and width >= 1500, 'Rendered image is smaller than the standard preview.')
            png = {'file': image.name, 'width': width, 'height': height, 'sha256': sha256(image)}
    tamper = secondary_tamper = None
    if require_tamper and size == max(SIZES):
        tamper_file = directory / ('river-tamper-verification.json' if terrain == 'inland' else 'estuary-tamper-verification.json')
        tamper = read_json(tamper_file)
        check(tamper.get('passed') is True and tamper.get('baselinePassed') is True, 'Largest-scale actual mesh tamper baseline/test did not pass.')
        check(tamper.get('sourceFilesSha256') == source_hashes, 'Largest-scale tamper report belongs to different source/scene files.')
        check(len(tamper.get('checks', [])) >= 7 and all(item.get('rejected') is True for item in tamper.get('checks', [])), 'At least seven meaningful real-mesh corruptions must be rejected.')
        if terrain == 'inland':
            check(tamper.get('bridgeId') in bridge_ids, 'Largest inland primary tamper evidence lacks a valid source bridge ID.')
            if len(bridge_ids) > 1:
                secondary_tamper = read_json(directory / 'river-tamper-secondary-verification.json')
                check(secondary_tamper.get('passed') is True and secondary_tamper.get('baselinePassed') is True, 'Largest inland secondary-bridge tamper baseline/test did not pass.')
                check(secondary_tamper.get('sourceFilesSha256') == source_hashes, 'Secondary-bridge tamper evidence belongs to different source/scene files.')
                check(len(secondary_tamper.get('checks', [])) >= 7 and all(item.get('rejected') is True for item in secondary_tamper.get('checks', [])), 'At least seven real-mesh corruptions of the second bridge must be rejected.')
                check({tamper.get('bridgeId'), secondary_tamper.get('bridgeId')} == bridge_ids, 'Largest inland tamper evidence does not cover every source bridge ID.')
    return {'case': terrain + '-' + str(size), 'terrain': terrain, 'size': size, 'passed': not errors,
            'counts': counts, 'sourceFilesSha256': source_hashes, 'image': png,
            'bankShells': len(shells), 'bankOpenEdges': sum(item.get('openEdgeCount', 0) for item in shells),
            'bankInvalidEdges': sum(item.get('invalidEdgeCount', 0) for item in shells),
            'marketIds': sorted(market_ids), 'tamperChecks': len(tamper['checks']) if tamper else None,
            'secondaryBridgeTamper': {'bridgeId': secondary_tamper.get('bridgeId'), 'checks': len(secondary_tamper['checks'])} if secondary_tamper else None,
            'errors': errors}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=ROOT / 'artifacts/river-all-sizes')
    parser.add_argument('--case', action='append', choices=[terrain + '-' + str(size) for terrain in TERRAINS for size in SIZES])
    parser.add_argument('--allow-partial', action='store_true', help='Audit available reports while builds are still in progress.')
    parser.add_argument('--no-images', action='store_true', help='Use only during the verification phase, before photography.')
    parser.add_argument('--require-tamper', action='store_true')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    fingerprint_run = subprocess.run(['node', '--input-type=module', '-e',
        "import { fingerprints } from './apps/playground/server/three-d-cache.mjs'; console.log(JSON.stringify(await fingerprints(process.cwd())));"],
        cwd=ROOT, text=True, encoding='utf-8', capture_output=True, check=True)
    current_fingerprints = json.loads(fingerprint_run.stdout)
    rows, missing = [], []
    for terrain in TERRAINS:
        for size in SIZES:
            name = terrain + '-' + str(size)
            if args.case and name not in args.case:
                continue
            directory = args.root.resolve() / name
            try:
                rows.append(audit_case(directory, terrain, size, not args.no_images, args.require_tamper, current_fingerprints))
            except (OSError, ValueError, KeyError, TypeError, struct.error) as error:
                if args.allow_partial and isinstance(error, FileNotFoundError):
                    missing.append(name)
                else:
                    rows.append({'case': name, 'terrain': terrain, 'size': size, 'passed': False, 'errors': [str(error)]})
    complete = len(rows) == (len(args.case) if args.case else len(TERRAINS) * len(SIZES)) and not missing
    passed = bool(rows) and all(row['passed'] for row in rows) and (complete or args.allow_partial)
    result = {'passed': passed, 'complete': complete, 'sizes': list(SIZES), 'terrains': list(TERRAINS),
              'imagesRequired': not args.no_images, 'largestTamperRequired': args.require_tamper,
              'currentProductionFingerprints': current_fingerprints,
              'cases': rows, 'missing': missing,
              'method': 'Independent source-to-adapter reconstruction, actual file SHA reconciliation with saved-scene world-mesh structural reports, nested result inspection, bridge/bank/market/fortification coverage and PNG checks.'}
    target = args.output or args.root / 'independent-audit.json'
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'passed': passed, 'complete': complete, 'cases': len(rows), 'missing': missing,
                      'failures': {row['case']: row['errors'] for row in rows if not row['passed']}, 'report': str(target)}, ensure_ascii=False, indent=2))
    return 0 if passed else 1


if __name__ == '__main__':
    sys.exit(main())
