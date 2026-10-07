"""NHL browser checks at a GitHub Pages project subpath."""
import json, math, unittest
import test_browser as helper
ROOT=helper.ROOT
from playwright.sync_api import sync_playwright
class NHLBrowserTests(unittest.TestCase):
 setUpClass=classmethod(helper.BrowserTests.setUpClass.__func__)
 tearDownClass=classmethod(helper.BrowserTests.tearDownClass.__func__)
 def test_nhl_all_teams_and_scenarios(self):
  with sync_playwright() as p:
   browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
   page=browser.new_page();errors=[];bad=[]
   page.on('pageerror',lambda e:errors.append(str(e)))
   page.on('console',lambda message:errors.append(message.text) if message.type=='error' else None)
   page.on('response',lambda r:bad.append(r.url) if r.status>=400 else None)
   page.goto(self.url+'nhl.html');page.wait_for_function("!document.getElementById('runButton').disabled")
   self.assertIn('50/50',page.locator('#status').inner_text())
   teams=page.locator('#team1 option').evaluate_all('(opts)=>opts.map(o=>o.value)');self.assertEqual(len(set(teams)),32)
   meta=json.loads((ROOT/'data/nhl/snapshot.json').read_text())['metadata']
   self.assertIn(meta['dataThrough'],page.locator('#dataInfo').inner_text())
   prov=json.loads((ROOT/'data/nhl/provenance.json').read_text())['metadata']
   self.assertEqual(meta['modelBuiltAt'],prov['modelBuiltAt'])
   details=page.locator('#dataDetails').text_content()
   for stamp in [meta['modelBuiltAt'],meta['sourcesRetrieved']['earliest'],meta['sourcesRetrieved']['latest']]:
    self.assertIn(page.evaluate('(stamp)=>new Date(stamp).toLocaleString()',stamp),details)
   for index,a in enumerate(teams):
    b=teams[(index+7)%32]
    for first,second in [(a,b),(b,a)]:
     page.locator('#team1').select_option(first);page.locator('#team2').select_option(second)
     page.locator('#homeTeam').set_checked(index%2==0)
     page.locator('#runButton').click();page.wait_for_function("document.getElementById('results').classList.contains('show')")
     probs=[float(page.locator('#prob'+str(i)).inner_text().rstrip('%')) for i in [1,2]]
     self.assertAlmostEqual(sum(probs),100,places=1);self.assertTrue(all(0<=v<=100 for v in probs))
     text=page.locator('#results').inner_text();self.assertNotIn('NaN',text);self.assertNotIn('undefined',text);self.assertNotIn('null',text)
   page.locator('#again').click();page.wait_for_function("!document.getElementById('runButton').disabled");self.assertEqual(probs,[float(page.locator('#prob'+str(i)).inner_text().rstrip('%')) for i in [1,2]])
   self.assertIn('FULL GAME WIN %',page.locator('#results').inner_text());self.assertIn('MoneyPuck',page.locator('main').inner_text())
   page.locator('a.sport').click();page.wait_for_function("!document.getElementById('runButton').disabled");self.assertIn('50/50',page.locator('#status').inner_text())
   page.locator('a.sport[href="./nhl.html"]').click();page.wait_for_function("!document.getElementById('runButton').disabled")
   page.set_viewport_size({'width':375,'height':812})
   page.locator('details').evaluate_all('(xs)=>xs.forEach(e=>e.open=true)')
   self.assertTrue(page.evaluate('document.documentElement.scrollWidth<=window.innerWidth'))
   options=page.locator('#goalie1 option').count()
   if options>1:
    page.locator('#goalie1').select_option(index=1);page.locator('#runButton').click()
    page.wait_for_function("document.getElementById('results').classList.contains('show')")
    self.assertIn('projected',page.locator('#goalieImpact').inner_text())
   self.assertEqual(errors,[]);self.assertEqual(bad,[]);browser.close()
 def test_nhl_missing_snapshot(self):
  with sync_playwright() as p:
   browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
   page=browser.new_page();page.route('**/data/nhl/snapshot.json',lambda r:r.fulfill(status=503,body='Unavailable'))
   page.goto(self.url+'nhl.html');page.wait_for_function("document.getElementById('status').textContent.includes('unavailable')")
   self.assertTrue(page.locator('#runButton').is_disabled());browser.close()

 def test_nhl_missing_goalie_is_explicit_unknown(self):
  snapshot=json.loads((ROOT/'data/nhl/snapshot.json').read_text())
  for team in snapshot['model']['teams'].values():
   team['goalie']['candidates']=[];team['goalie']['gsax60']=0
  with sync_playwright() as p:
   browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
   page=browser.new_page();page.route('**/data/nhl/snapshot.json',lambda r:r.fulfill(status=200,content_type='application/json',body=json.dumps(snapshot)))
   page.goto(self.url+'nhl.html');page.wait_for_function("!document.getElementById('runButton').disabled")
   self.assertEqual(page.locator('#goalie1 option').count(),1);page.locator('#runButton').click()
   page.wait_for_function("document.getElementById('results').classList.contains('show')")
   self.assertIn('unknown',page.locator('#goalieImpact').inner_text());self.assertNotIn('NaN',page.locator('#results').inner_text())
   browser.close()
