import importlib.util, unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('build_data',Path(__file__).resolve().parents[1]/'scripts/build_data.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class IngestionTests(unittest.TestCase):
 def test_schema_change_fails(self):
  with self.assertRaises(ValueError):m.require(['old_team'],['team'],'fixture')
 def test_numbers(self):
  for value in ['',None,'NA','nan','inf']:self.assertIsNone(m.number(value))
  self.assertEqual(m.number('0'),0)
 def test_availability_delay(self):self.assertEqual(m.available('2026-09-30'),'2026-10-01T12:00:00Z')
 def test_team_alias(self):self.assertEqual(m.team('LAR'),'LA')

import io, json, tempfile, urllib.error
from unittest.mock import patch

class SourceTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
  self.cache=Path(self.temp.name);self.report={};self.url='https://example.test/stats.csv'
  self.content=b'team,points\nCIN,24\n'
  self.refresh=patch.object(m,'REFRESH',True);self.refresh.start();self.addCleanup(self.refresh.stop)
 def read(self,optional=True):return m.read_source('fixture',self.url,['team','points'],self.cache,self.report,optional=optional)
 def fetch(self):
  with patch.object(m.urllib.request,'urlopen',return_value=io.BytesIO(self.content)):return self.read()
 def failure(self):return patch.object(m.urllib.request,'urlopen',side_effect=urllib.error.HTTPError(self.url,404,'Not Found',{},None))
 def test_successful_retrieval(self):
  self.assertEqual(self.fetch(),[{'team':'CIN','points':'24'}])
  record=self.report['fixture'];self.assertEqual(record['status'],'available');self.assertFalse(record['cacheUsed']);self.assertFalse(record['required'])
  self.assertIsNotNone(record['retrievedAt']);self.assertEqual((self.cache/'fixture').read_bytes(),self.content)
  self.assertEqual(json.loads((self.cache/'fixture.retrieval.json').read_text())['retrievedAt'],record['retrievedAt'])
 def test_cached_fallback_preserves_fetch_timestamp(self):
  self.fetch();original=self.report['fixture']['retrievedAt']
  with self.failure(),self.assertLogs(level='WARNING') as logs:self.assertEqual(self.read(),[{'team':'CIN','points':'24'}])
  self.assertIn('using validated cached data',' '.join(logs.output))
  self.assertEqual(self.report['fixture']['status'],'cached');self.assertTrue(self.report['fixture']['cacheUsed'])
  self.assertEqual(self.report['fixture']['retrievedAt'],original);self.assertIn('404',self.report['fixture']['warning'])
 def test_optional_404_no_cache(self):
  with self.failure(),self.assertLogs(level='WARNING') as logs:self.assertEqual(self.read(),[])
  self.assertIn('omitting source',' '.join(logs.output));self.assertEqual(self.report['fixture']['status'],'unavailable')
  self.assertIsNone(self.report['fixture']['retrievedAt']);self.assertFalse((self.cache/'fixture').exists())
 def test_required_failure_is_loud(self):
  with self.failure(),self.assertRaisesRegex(RuntimeError,'Required source fixture unavailable'):self.read(optional=False)
  self.assertTrue(self.report['fixture']['required']);self.assertEqual(self.report['fixture']['status'],'unavailable')
 def test_invalid_download_preserves_valid_cache(self):
  self.fetch();original=self.report['fixture']['retrievedAt']
  with patch.object(m.urllib.request,'urlopen',return_value=io.BytesIO(b'wrong\nvalue\n')),self.assertLogs(level='WARNING'):self.read()
  self.assertEqual((self.cache/'fixture').read_bytes(),self.content);self.assertEqual(self.report['fixture']['retrievedAt'],original)
 def test_corrupt_cache_not_a_replacement(self):
  (self.cache/'fixture').write_bytes(b'wrong\nvalue\n')
  with self.failure(),self.assertLogs(level='WARNING'):self.assertEqual(self.read(),[])
  self.assertEqual(self.report['fixture']['status'],'unavailable');self.assertIn('cacheError',self.report['fixture'])
 def test_cached_rebuild_does_not_advance_retrieval(self):
  self.fetch();original=self.report['fixture']['retrievedAt'];summary=m.source_retrieval_summary(self.report)
  with patch.object(m,'REFRESH',False),patch.object(m.urllib.request,'urlopen') as fetch:
   self.read();fetch.assert_not_called()
  self.assertEqual(self.report['fixture']['retrievedAt'],original)
  self.assertEqual(m.source_retrieval_summary(self.report)['latest'],summary['latest'])
 def test_legacy_cache_does_not_invent_retrieval_time(self):
  (self.cache/'fixture').write_bytes(self.content)
  with patch.object(m,'REFRESH',False):self.read()
  self.assertIsNone(self.report['fixture']['retrievedAt']);self.assertEqual(m.source_retrieval_summary(self.report)['unknown'],['fixture'])

 def test_required_valid_cache_remains_usable(self):
  self.fetch()
  with self.failure(),self.assertLogs(level='WARNING'):
   self.assertEqual(self.read(optional=False),[{'team':'CIN','points':'24'}])
  self.assertTrue(self.report['fixture']['required']);self.assertTrue(self.report['fixture']['cacheUsed'])

class BuildFallbackTests(unittest.TestCase):
 def test_complete_build_without_optional_sources_and_stable_retrieval_time(self):
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory);(root/'data').mkdir();cache=root/'cache';cache.mkdir()
   original=m.ROOT
   (root/'data/teams.json').write_bytes((original/'data/teams.json').read_bytes())
   schedule=b'game_id,season,game_type,week,gameday,home_team,away_team,home_score,away_score,location,home_rest,away_rest\n2026_01_CIN_BAL,2026,REG,1,2026-09-13,BAL,CIN,24,21,Home,7,7\n'
   def response(url,**kwargs):
    if url.endswith('/games.csv'):return io.BytesIO(schedule)
    raise urllib.error.HTTPError(url,404,'Not Found',{},None)
   with patch.object(m,'ROOT',root),patch.object(m,'REFRESH',False),patch.object(m.urllib.request,'urlopen',side_effect=response),self.assertLogs(level='WARNING'):
    first,provenance=m.build(2026,'2026-09-15T00:00:00Z',cache)
    second,again=m.build(2026,'2026-09-15T00:00:00Z',cache)
   self.assertEqual(first['metadata']['currentGames'],1);self.assertEqual(first['games'][0]['stats'],{})
   self.assertEqual(first['metadata']['sourcesRetrieved']['latest'],second['metadata']['sourcesRetrieved']['latest'])
   self.assertNotEqual(first['metadata']['modelBuiltAt'],second['metadata']['modelBuiltAt'])
   self.assertEqual(again['sources']['schedule']['status'],'cached')
   self.assertEqual(len(second['metadata']['sourcesRetrieved']['unavailable']),9)
   self.assertTrue(all(v['status']=='unavailable' for k,v in provenance['sources'].items() if k!='schedule'))

if __name__=='__main__':unittest.main()
