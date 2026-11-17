const {test,expect}=require('@playwright/test');
for(const available of [false,true]){
 test(`regular shell is default when Claude is ${available?'installed':'absent'}`,async({page})=>{
  await page.addInitScript(available=>{
   const solution={name:'Demo.sln',path:'/workspace/Demo/Demo.sln',format:'sln',projects:[{id:'demo',name:'Demo',path:'/workspace/Demo/Demo.csproj',targetFramework:'net10.0',projectType:'console',dependencies:{frameworks:[],packages:[],projectReferences:[]},files:[{id:'program',name:'Program.cs',path:'/workspace/Demo/Program.cs',relativePath:'Program.cs',extension:'.cs',isDirectory:false,content:'Console.WriteLine("Hello");'}]}]};
   localStorage.setItem('sharpforge.lastSolutionPath',solution.path);let sessions=[];window.createdTerminalKinds=[];
   window.electronAPI={isElectron:true,runCommand:async()=>({success:true,stdout:'',stderr:''}),loadSolution:async()=>solution,terminalList:async()=>({claudeAvailable:available,sessions}),terminalCreate:async({kind,cwd})=>{window.createdTerminalKinds.push(kind);const session={id:String(sessions.length+1),cwd,kind,title:kind==='claude'?'Claude':'Terminal',output:'Ready\r\n',outputLength:7,sequence:0,exited:false};sessions.push(session);return session;},terminalWrite:async()=>true,terminalResize:async()=>{},terminalClose:async()=>{},onTerminalEvent:()=>()=>{}};
  },available);
  await page.goto('/');const shell=page.getByRole('tab',{name:'Terminal 1',exact:true});await expect(shell).toHaveAttribute('aria-selected','true');expect(await page.evaluate(()=>window.createdTerminalKinds)).toEqual(['shell']);await expect(page.getByRole('tab',{name:'Claude',exact:true})).toHaveCount(0);
  const button=page.getByRole('button',{name:'Open Claude',exact:true});if(available){await expect(button).toBeVisible();await button.click();await expect(page.getByRole('tab',{name:'Claude',exact:true})).toHaveAttribute('aria-selected','true');expect(await page.evaluate(()=>window.createdTerminalKinds)).toEqual(['shell','claude']);}else await expect(button).toHaveCount(0);
 });
}
