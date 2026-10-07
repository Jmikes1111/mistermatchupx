import importlib.util,sys,unittest,tempfile,urllib.error
from unittest.mock import patch,MagicMock
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts/nhl'))
import moneypuck
spec=importlib.util.spec_from_file_location('nhl_builder',Path(__file__).resolve().parents[1]/'scripts/nhl/build_data.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class NhlIngestionTests(unittest.TestCase):
 def test_download_cache_and_source_failures(self):
  url='https://example.test/nhl.csv'
  with tempfile.TemporaryDirectory() as directory:
   cache=Path(directory);records={};response=MagicMock();response.__enter__.return_value.read.return_value=b'gameId\n1\n'
   with patch('moneypuck.urllib.request.urlopen',return_value=response) as fetch:
    self.assertEqual(moneypuck.download(url,cache,records),b'gameId\n1\n');fetch.assert_called_once()
   with patch('moneypuck.urllib.request.urlopen',side_effect=AssertionError('cache should avoid network')):
    self.assertEqual(moneypuck.download(url,cache,records),b'gameId\n1\n');self.assertTrue(records[url]['cacheUsed'])
   missing='https://example.test/missing.csv'
   with patch('moneypuck.urllib.request.urlopen',side_effect=urllib.error.HTTPError(missing,404,'not found',{},None)):
    self.assertIsNone(moneypuck.download(missing,cache,records,optional=True));self.assertEqual(records[missing]['status'],'unavailable')
    with self.assertRaisesRegex(RuntimeError,'Required NHL source unavailable'):moneypuck.download(missing,cache,records)
 def test_schema_change_fails_safely(self):
  with self.assertRaisesRegex(ValueError,'schema missing'):moneypuck.csv_rows(b'wrong\nvalue\n',['gameId'],'fixture')
 def test_optional_missing_is_empty_not_fabricated(self):self.assertEqual(moneypuck.csv_rows(None,['gameId'],'optional'),[])
 def test_invalid_number_not_zero(self):self.assertIsNone(moneypuck.num('NaN'));self.assertIsNone(moneypuck.num(''));self.assertEqual(moneypuck.num('0'),0)
 def test_team_game_cutoff_excludes_future_and_playoff(self):
  def row(day,playoff='0'):
   r={'season':'2026','gameDate':day,'playoffGame':playoff,'situation':'5on5','gameId':day,'playerTeam':'CAR','opposingTeam':'NYR','home_or_away':'HOME'}
   r.update({v:'1' for v in m.SIDE_FIELDS.values()});return r
  normalized=m.normalize_team([row('20261001'),row('20261008'),row('20261002','1')],{2026},'2026-10-06T12:00:00Z')
  self.assertEqual(list(normalized),['20261001']);self.assertEqual(normalized['20261001']['availableAt'],'2026-10-02T12:00:00Z')
 def test_duplicate_game_situation_rejected(self):
  r={'season':'2026','gameDate':'20261001','playoffGame':'0','situation':'5on5','gameId':'1','playerTeam':'CAR','opposingTeam':'NYR','home_or_away':'HOME',**{v:'1' for v in m.SIDE_FIELDS.values()}}
  with self.assertRaisesRegex(ValueError,'Duplicate'):m.normalize_team([r,r],{2026},'2026-10-06T12:00:00Z')
 def test_current_franchise_alias_is_explicit(self):self.assertEqual(m.code('ARI'),'UTA')
if __name__=='__main__':unittest.main()
