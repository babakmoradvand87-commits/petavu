#!/usr/bin/env python3
"""Owner-authorized, one-shot GitHub publication. Credentials exist only in the job environment.
Creates new dedicated repositories; refuses unrelated existing repositories. No database operations.
Private full source -> review branch/draft PR. Public repo -> launch artifact ONLY.
"""
import os,json,base64,re,time,hashlib,urllib.request,urllib.error,concurrent.futures
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
REPORT=ROOT/'release/deployment.json'
TOKEN=os.environ.get('GH_TASK_TOKEN','')
if not TOKEN:raise SystemExit('Missing temporary GitHub authorization; no account operation performed.')
HEADERS={'Authorization':'Bearer '+TOKEN,'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'PETAVU-owner-authorized-publisher','Content-Type':'application/json'}
state=json.loads(REPORT.read_text()) if REPORT.exists() else {'version':'0.2.0','database_changed':False,'credentials_saved':False}
def save():REPORT.parent.mkdir(exist_ok=True);REPORT.write_text(json.dumps(state,ensure_ascii=False,indent=2)+'\n')
class ApiError(Exception):
 def __init__(self,status,message):self.status=status;super().__init__(f'GitHub HTTP {status}: {message}')
def api(method,path,data=None):
 req=urllib.request.Request('https://api.github.com'+path,data=None if data is None else json.dumps(data,ensure_ascii=False).encode(),headers=HEADERS,method=method)
 try:
  with urllib.request.urlopen(req,timeout=45) as r:return json.load(r) if r.status!=204 else {}
 except urllib.error.HTTPError as e:
  body=json.loads(e.read());raise ApiError(e.code,str(body.get('message','Request denied'))[:240]) from None

def repository(owner,name,private,kind):
 saved=state.get(kind+'_repository')
 try:existing=api('GET',f'/repos/{owner}/{name}')
 except ApiError as e:
  if e.status!=404:raise
  existing=None
 if existing:
  if not saved or existing['id']!=saved.get('id') or existing['private']!=private:
   raise RuntimeError('Target repository already exists and was not created by this task. Refusing to overwrite it.')
  return existing
 r=api('POST','/user/repos',{'name':name,'private':private,'auto_init':True,'description':'PETAVU full project — private review source' if private else 'PETAVU public coming-soon page only. No panels, backend or account data.','allow_auto_merge':False})
 state[kind+'_repository']={'id':r['id'],'name':r['full_name'],'url':r['html_url'],'private':r['private'],'created_by_this_task':True};save()
 print(kind.upper()+'_REPOSITORY_CREATED '+r['html_url'],flush=True)
 return r

def branch_head(repo,branch):
 try:return api('GET',f"/repos/{repo['full_name']}/git/ref/heads/{branch}")['object']['sha']
 except ApiError as e:
  if e.status not in (404,409):raise
  return None

def initialized_head(repo,branch):
 for _ in range(10):
  result=branch_head(repo,branch)
  if result:return result
  time.sleep(1)
 return None

def upload_tree(repo,files,base_tree=None):
 entries=[];binary=[]
 for git_path,p in files:
  raw=p.read_bytes()
  if re.search(rb'(?:ghp_|github_pat_|sbp_|sb_secret_)[A-Za-z0-9_]{20,}',raw):raise RuntimeError('Potential credential pattern found; refusing publication.')
  try:content=raw.decode('utf-8')
  except UnicodeDecodeError:binary.append((git_path,raw));continue
  if '\0' in content:binary.append((git_path,raw));continue
  entries.append({'path':git_path,'mode':'100755' if git_path.endswith('.sh') else '100644','type':'blob','content':content})
 def blob(item):
  name,raw=item;r=api('POST',f"/repos/{repo['full_name']}/git/blobs",{'content':base64.b64encode(raw).decode(),'encoding':'base64'});return {'path':name,'mode':'100644','type':'blob','sha':r['sha']}
 with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:entries.extend(pool.map(blob,binary))
 data={'tree':entries}
 if base_tree:data['base_tree']=base_tree
 return api('POST',f"/repos/{repo['full_name']}/git/trees",data)['sha']

def commit_and_reference(repo,branch,tree,parent,message):
 data={'message':message,'tree':tree,'parents':[parent] if parent else [],'author':{'name':'PETAVU Workspace','email':'petavu-workspace@example.invalid'},'committer':{'name':'PETAVU Workspace','email':'petavu-workspace@example.invalid'}}
 commit=api('POST',f"/repos/{repo['full_name']}/git/commits",data)
 if branch_head(repo,branch):api('PATCH',f"/repos/{repo['full_name']}/git/refs/heads/{branch}",{'sha':commit['sha'],'force':False})
 else:api('POST',f"/repos/{repo['full_name']}/git/refs",{'ref':'refs/heads/'+branch,'sha':commit['sha']})
 return commit['sha']

def source_files():
 exclude={'node_modules','dist','release','.git','test-results','playwright-report','backups','secrets','credentials','__pycache__','design-history'}
 result=[]
 for base,dirs,names in os.walk(ROOT):
  dirs[:]=[d for d in dirs if d not in exclude]
  for name in names:
   p=Path(base)/name;rel=p.relative_to(ROOT)
   if name.startswith('.env') and name!='.env.example':raise RuntimeError('Unexpected environment file; refusing source upload.')
   if p.suffix in {'.key','.pem','.dump','.backup','.log'}:raise RuntimeError('Unexpected credential/data file.')
   if rel.parts[0]=='assets' and p.suffix=='.png':continue
   result.append((rel.as_posix(),p))
 checkpoint=ROOT/'design-history/PETAVU-v0.1.zip'
 if checkpoint.is_file():result.append(('design-history/PETAVU-v0.1.zip',checkpoint))
 return result

try:
 owner=api('GET','/user')['login']
 if not re.fullmatch(r'[A-Za-z0-9-]+',owner):raise RuntimeError('Unexpected GitHub owner identifier.')
 state['owner']=owner;state['status']='publishing';save()
 source=repository(owner,'petavu',True,'source');branch='agent/scroll-3d-redesign'
 parent=branch_head(source,branch) or initialized_head(source,source['default_branch'])
 if not parent:raise RuntimeError('Private repository initialization has not completed.')
 base_tree=api('GET',f"/repos/{source['full_name']}/git/commits/{parent}")['tree']['sha']
 files=source_files();print('SOURCE_UPLOAD '+str(len(files))+' secret-free source/design files',flush=True)
 tree=upload_tree(source,files,base_tree);source_sha=commit_and_reference(source,branch,tree,parent,'PETAVU v0.2: real scroll-driven 3D, complete UI redesign and isolated public launch')
 state.update({'source_branch':branch,'source_commit':source_sha,'source_branch_url':source['html_url']+'/tree/'+branch});save();print('SOURCE_PUSHED '+state['source_branch_url'],flush=True)
 prs=api('GET',f"/repos/{source['full_name']}/pulls?state=open&head={owner}:{branch}")
 pr=prs[0] if prs else api('POST',f"/repos/{source['full_name']}/pulls",{'title':'PETAVU v0.2 — real 3D scroll + five-space redesign','head':branch,'base':source['default_branch'],'draft':True,'body':'Owner review: actual WebGL meshes and scroll-controlled camera; redesigned website/panel/adminpanel/shop/adminshop; independent public coming-soon entry; 10 browser tests and 11 local RLS checks passed. No database migration, paid upgrade, domain change or production member authentication. CI remains an inactive template. No credentials are stored in source or artifacts. Public launch is published separately.'})
 state['pull_request_url']=pr['html_url'];save();print('DRAFT_PR '+pr['html_url'],flush=True)
 public=repository(owner,'petavu-coming-soon',False,'public')
 artifact=ROOT/'release/public-site';public_files=[(p.relative_to(artifact).as_posix(),p) for p in sorted(artifact.rglob('*')) if p.is_file()]
 if not public_files or not (artifact/'index.html').is_file():raise RuntimeError('Public launch artifact missing.')
 parent=initialized_head(public,public['default_branch'])
 if not parent:raise RuntimeError('Public repository initialization has not completed.')
 # Exact new root tree removes only the generated bootstrap README; no internal source is published.
 tree=upload_tree(public,public_files);public_sha=commit_and_reference(public,public['default_branch'],tree,parent,'Publish PETAVU coming-soon only — portable static 3D page')
 state['public_commit']=public_sha;state['public_file_count']=len(public_files);save()
 try:pages=api('GET',f"/repos/{public['full_name']}/pages")
 except ApiError as e:
  if e.status!=404:raise
  pages=api('POST',f"/repos/{public['full_name']}/pages",{'build_type':'legacy','source':{'branch':public['default_branch'],'path':'/'}})
 url=(pages.get('html_url') or f'https://{owner.lower()}.github.io/petavu-coming-soon/').replace('http://','https://')
 if not url.endswith('/'):url+='/'
 state.update({'pages_url':url,'status':'pages_build_pending','pages_ready':False});save();print('PAGES_CONFIGURED '+url,flush=True)
 try:api('POST',f"/repos/{public['full_name']}/pages/builds",{})
 except ApiError as e:
  if e.status not in (409,422):raise
 for attempt in range(36):
  try:
   req=urllib.request.Request(url,headers={'User-Agent':'PETAVU-anonymous-launch-verification'})
   with urllib.request.urlopen(req,timeout=20) as r:
    html=r.read().decode('utf-8','replace');status=r.status
   if status==200 and hashlib.sha256(html.encode('utf-8')).hexdigest()==hashlib.sha256((artifact/'index.html').read_bytes()).hexdigest():
    state.update({'pages_ready':True,'anonymous_http_status':200,'status':'published'});save();print('PAGES_READY '+url,flush=True);break
  except (urllib.error.HTTPError,urllib.error.URLError,TimeoutError):pass
  if attempt%6==0:print('WAITING_FOR_PAGES_BUILD '+str(attempt),flush=True)
  time.sleep(8)
 else:print('PAGES_PENDING '+url,flush=True)
except Exception as error:
 state.update({'status':'needs_attention','error':str(error)[:400]});save()
 print('PUBLICATION_INCOMPLETE '+str(error)[:400],flush=True)
 raise SystemExit(1)
