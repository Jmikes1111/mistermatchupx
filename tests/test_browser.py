"""Integration check at a repository subpath, matching GitHub project Pages."""
import functools, http.server, threading, unittest, json
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
class QuietHandler(http.server.SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
class BrowserTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(QuietHandler,directory=str(ROOT.parent)))
  threading.Thread(target=cls.server.serve_forever,daemon=True).start()
  cls.url=f'http://127.0.0.1:{cls.server.server_port}/{ROOT.name}/'
 @classmethod
 def tearDownClass(cls):cls.server.shutdown();cls.server.server_close()
 def test_browser_controls_and_mobile(self):
  with sync_playwright() as p:
   browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
   page=browser.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   page.goto(self.url);page.wait_for_function("!document.getElementById('runButton').disabled")
   self.assertIn('50/50',page.locator('#status').inner_text());self.assertEqual(page.locator('#team1 option').count(),32)
   meta=json.loads((ROOT/'data/snapshot.json').read_text())['metadata']
   self.assertIn(f"Data through: {meta['season']} Week {meta['latestWeek']}",page.locator('#dataInfo').inner_text())
   self.assertIn(meta['latestGameDate'],page.locator('#dataInfo').inner_text())
   details=page.locator('#dataDetails').text_content()
   for stamp in [meta['modelBuiltAt'],meta['sourcesRetrieved']['earliest'],meta['sourcesRetrieved']['latest']]:
    formatted=page.evaluate('(stamp)=>new Date(stamp).toLocaleString()',stamp)
    self.assertIn(formatted,details)
   self.assertNotIn('Updated',page.locator('#dataInfo').inner_text())
   page.locator('#runButton').click();page.wait_for_function("document.getElementById('results').classList.contains('show')")
   self.assertIn('10,000 games',page.locator('#status').inner_text())
   self.assertAlmostEqual(sum(float(page.locator('#'+x).inner_text().rstrip('%')) for x in ['prob1','prob2']),100,places=1)
   self.assertIn('Injuries are not modeled',page.locator('#whyText').inner_text())
   page.locator('#again').click();page.wait_for_function("!document.getElementById('runButton').disabled")
   page.locator('#newMatchup').click();self.assertFalse(page.locator('#results').is_visible())
   page.locator('#team2').select_option('CIN');dialogs=[]
   page.on('dialog',lambda d:(dialogs.append(d.message),d.accept()));page.locator('#runButton').click()
   self.assertEqual(dialogs,['Please select two different teams.'])
   page.locator('#team2').select_option('BAL');page.locator('#runButton').click();page.wait_for_function("document.getElementById('results').classList.contains('show')")
   page.locator('#homeTeam').uncheck();self.assertFalse(page.locator('#results').is_visible())
   page.set_viewport_size({'width':375,'height':812})
   self.assertTrue(page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'))
   self.assertEqual(errors,[]);browser.close()
 def test_failed_data_load_disables_predictions(self):
  with sync_playwright() as p:
   browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
   page=browser.new_page();page.route('**/data/snapshot.json',lambda route:route.fulfill(status=503,body='Unavailable'))
   page.goto(self.url);page.wait_for_function("document.getElementById('status').textContent.includes('Unable to load')")
   self.assertTrue(page.locator('#runButton').is_disabled());self.assertIn('no substitute ratings',page.locator('#dataInfo').inner_text());browser.close()
if __name__=='__main__':unittest.main()
