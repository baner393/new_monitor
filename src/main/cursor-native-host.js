// Runtime-written helper stays with the Vite main bundle; no installation or theme edits.
// API/ownership pattern references WormsCursor (MIT):
// https://github.com/dawidope/WormsCursor/blob/main/src/WormsCursor.Core/CursorEngine.cs
// Explicit resource sizes follow Microsoft's Windows-classic-samples cursor sample (MIT).
export const CURSOR_HOST_SOURCE = String.raw`
param([int]$ParentProcessId)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -ReferencedAssemblies System.Drawing,System.Web.Extensions -TypeDefinition @'
using System;
using System.IO;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Diagnostics;
using System.Threading;
using System.Collections.Generic;
using System.Web.Script.Serialization;
using Microsoft.Win32;
public static class CursorHost {
  [StructLayout(LayoutKind.Sequential)] struct POINT { public int x,y; }
  [StructLayout(LayoutKind.Sequential)] struct CURSORINFO { public int size,flags; public IntPtr cursor; public POINT position; }
  [StructLayout(LayoutKind.Sequential)] struct ICONINFO { public bool icon; public int x,y; public IntPtr mask,color; }
  [StructLayout(LayoutKind.Sequential)] struct BITMAP { public int type,width,height,widthBytes; public ushort planes,bits; public IntPtr data; }
  [DllImport("user32.dll", SetLastError=true)] static extern bool GetCursorInfo(ref CURSORINFO info);
  [DllImport("user32.dll", SetLastError=true)] static extern bool GetIconInfo(IntPtr cursor,out ICONINFO info);
  [DllImport("gdi32.dll")] static extern int GetObject(IntPtr obj,int size,out BITMAP bitmap);
  [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr obj);
  [DllImport("user32.dll")] static extern IntPtr LoadCursor(IntPtr instance,IntPtr id);
  [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr LoadCursorFromFile(string path);
  [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr LoadImage(IntPtr instance,string path,uint type,int width,int height,uint flags);
  [DllImport("user32.dll",SetLastError=true)] static extern bool SetSystemCursor(IntPtr cursor,uint id);
  [DllImport("user32.dll",SetLastError=true)] static extern uint SetThreadCursorCreationScaling(uint cursorDpi);
  [DllImport("user32.dll")] static extern bool DestroyCursor(IntPtr cursor);
  [DllImport("user32.dll",SetLastError=true)] static extern bool SystemParametersInfo(uint action,uint value,IntPtr data,uint flags);
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int metric);
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern IntPtr GetThreadDpiAwarenessContext();
  [DllImport("user32.dll")] static extern int GetAwarenessFromDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll",SetLastError=true)] static extern bool DrawIconEx(IntPtr dc,int x,int y,IntPtr cursor,int width,int height,uint step,IntPtr brush,uint flags);
  static readonly string[] Roles={"Arrow","Help","AppStarting","Wait","Crosshair","IBeam","NWPen","No","SizeNS","SizeWE","SizeNWSE","SizeNESW","SizeAll","UpArrow","Hand"};
  static readonly int[] Ids={32512,32651,32650,32514,32515,32513,32631,32648,32645,32644,32642,32643,32646,32516,32649};
  static JavaScriptSerializer json=new JavaScriptSerializer(){MaxJsonLength=16777216};
  static Queue<string> commands=new Queue<string>();
  static volatile bool disconnected=false;
  static bool installed=false;
  static Dictionary<int,string> installedScalingModes=new Dictionary<int,string>();
  static Dictionary<int,string> installedSignatures=new Dictionary<int,string>();
  static int lastCheckedRole=-1;
  static void Emit(object value) { Console.WriteLine(json.Serialize(value)); Console.Out.Flush(); }
  static Exception Failure(string operation) { return new Exception(operation+" failed ("+Marshal.GetLastWin32Error()+")"); }
  static void Restore(bool force=false) {
    if (!installed&&!force) return;
    if(!SystemParametersInfo(0x57,0,IntPtr.Zero,0)) throw Failure("SPI_SETCURSORS");
    installed=false;installedScalingModes.Clear();installedSignatures.Clear();lastCheckedRole=-1;
  }
  static IntPtr LoadImageWithDpiMode(string path,int width,int height,uint dpiMode,out bool scalingSupported) {
    uint previous=0;scalingSupported=false;
    try { previous=SetThreadCursorCreationScaling(dpiMode); }
    catch(EntryPointNotFoundException) { }
    if(previous==0)throw new Exception("SetThreadCursorCreationScaling failed while selecting a cursor DPI mode");
    IntPtr cursor=IntPtr.Zero;
    try { cursor=LoadImage(IntPtr.Zero,path,2,width,height,0x10); }
    finally {
      uint restored=SetThreadCursorCreationScaling(previous);
      if(restored==0) {
        if(cursor!=IntPtr.Zero)DestroyCursor(cursor);
        throw new Exception("SetThreadCursorCreationScaling failed while restoring the previous cursor DPI mode");
      }
    }
    scalingSupported=true;
    return cursor;
  }
  static bool CursorScalingApiAvailable() {
    uint previous;
    try { previous=SetThreadCursorCreationScaling(1); }
    catch(EntryPointNotFoundException) { return false; }
    if(previous==0)return false;
    if(SetThreadCursorCreationScaling(previous)==0)
      throw new Exception("SetThreadCursorCreationScaling failed while restoring the previous cursor DPI mode during capability probe");
    return true;
  }
  static Dictionary<string,object> Info(IntPtr cursor) {
    ICONINFO icon;
    if(!GetIconInfo(cursor,out icon)) throw Failure("GetIconInfo");
    try {
      BITMAP bitmap; IntPtr handle=icon.color!=IntPtr.Zero?icon.color:icon.mask;
      if(GetObject(handle,Marshal.SizeOf(typeof(BITMAP)),out bitmap)==0) throw Failure("GetObject");
      return new Dictionary<string,object>{{"width",bitmap.width},{"height",icon.color!=IntPtr.Zero?bitmap.height:bitmap.height/2},
        {"hotspot",new Dictionary<string,int>{{"x",icon.x},{"y",icon.y}}}};
    } finally { if(icon.mask!=IntPtr.Zero)DeleteObject(icon.mask); if(icon.color!=IntPtr.Zero)DeleteObject(icon.color); }
  }
  static Bitmap Draw(IntPtr cursor,int width,int height,Color background,uint step=0) {
    Bitmap bitmap=new Bitmap(width,height,PixelFormat.Format32bppArgb);
    using(Graphics graphics=Graphics.FromImage(bitmap)) {
      graphics.Clear(background); IntPtr dc=graphics.GetHdc();
      try { if(!DrawIconEx(dc,0,0,cursor,width,height,step,IntPtr.Zero,3)) throw Failure("DrawIconEx"); }
      finally { graphics.ReleaseHdc(dc); }
    }
    return bitmap;
  }
  static Dictionary<string,object> Capture(IntPtr cursor,Dictionary<string,object> info) {
    int width=(int)info["width"],height=(int)info["height"];
    Dictionary<string,int> hotspot=(Dictionary<string,int>)info["hotspot"];
    using(Bitmap dark=Draw(cursor,width,height,Color.Black))
    using(Bitmap light=Draw(cursor,width,height,Color.White))
    using(Bitmap image=new Bitmap(width,height,PixelFormat.Format32bppArgb)) {
      byte[] bgra=new byte[width*height*4];
      for(int y=0;y<height;y++)for(int x=0;x<width;x++) {
        Color b=dark.GetPixel(x,y),w=light.GetPixel(x,y);
        int alpha=Math.Max(0,Math.Min(255,255-(w.R-b.R+w.G-b.G+w.B-b.B)/3));
        Color color=alpha==0?Color.Transparent:Color.FromArgb(alpha,Math.Min(255,b.R*255/alpha),Math.Min(255,b.G*255/alpha),Math.Min(255,b.B*255/alpha));
        image.SetPixel(x,y,color); int index=((height-1-y)*width+x)*4;
        bgra[index]=color.B;bgra[index+1]=color.G;bgra[index+2]=color.R;bgra[index+3]=color.A;
      }
      using(MemoryStream png=new MemoryStream())using(MemoryStream cur=new MemoryStream())using(BinaryWriter writer=new BinaryWriter(cur)) {
        image.Save(png,ImageFormat.Png);
        int maskStride=((width+31)/32)*4, payload=40+bgra.Length+maskStride*height;
        writer.Write((ushort)0);writer.Write((ushort)2);writer.Write((ushort)1);
        writer.Write((byte)(width==256?0:width));writer.Write((byte)(height==256?0:height));writer.Write((ushort)0);
        writer.Write((ushort)hotspot["x"]);writer.Write((ushort)hotspot["y"]);writer.Write(payload);writer.Write(22);
        writer.Write(40);writer.Write(width);writer.Write(height*2);writer.Write((ushort)1);writer.Write((ushort)32);
        writer.Write(0);writer.Write(bgra.Length);writer.Write(0);writer.Write(0);writer.Write(0);writer.Write(0);writer.Write(bgra);
        byte[] mask=new byte[maskStride*height];
        for(int y=0;y<height;y++)for(int x=0;x<width;x++)if(bgra[(y*width+x)*4+3]==0)mask[y*maskStride+x/8]|=(byte)(128>>(x%8));
        writer.Write(mask);writer.Flush();
        return new Dictionary<string,object>{{"curBase64",Convert.ToBase64String(cur.ToArray())},{"dataUrl","data:image/png;base64,"+Convert.ToBase64String(png.ToArray())}};
      }
    }
  }
  static string ThemeSignature() {
    using(RegistryKey key=Registry.CurrentUser.OpenSubKey(@"Control Panel\Cursors")) {
      string signature=GetSystemMetrics(13)+"x"+GetSystemMetrics(14)+"|"+(key==null?"":Convert.ToString(key.GetValue("CursorBaseSize","")));
      foreach(string role in Roles) {
        string asset=Environment.ExpandEnvironmentVariables(key==null?"":Convert.ToString(key.GetValue(role,"")));
        signature+="|"+role+"="+asset;
        if(File.Exists(asset)){FileInfo file=new FileInfo(asset);signature+="@"+file.Length+":"+file.LastWriteTimeUtc.Ticks;}
      }
      return signature;
    }
  }
  static string CursorSignature(int role) {
    IntPtr cursor=LoadCursor(IntPtr.Zero,new IntPtr(role));Dictionary<string,object> info=Info(cursor);
    using(Bitmap image=Draw(cursor,(int)info["width"],(int)info["height"],Color.Black,0))using(MemoryStream stream=new MemoryStream()) {
      image.Save(stream,ImageFormat.Png);
      return json.Serialize(info)+":"+Convert.ToBase64String(stream.ToArray());
    }
  }
  static bool CopiesChanged() {
    foreach(KeyValuePair<int,string> pair in installedSignatures)if(CursorSignature(pair.Key)!=pair.Value)return true;
    return false;
  }
  static object Theme() {
    List<object> roles=new List<object>();
    using(RegistryKey key=Registry.CurrentUser.OpenSubKey(@"Control Panel\Cursors")) {
      for(int i=0;i<Roles.Length;i++) {
        IntPtr cursor=LoadCursor(IntPtr.Zero,new IntPtr(Ids[i]));
        Dictionary<string,object> role=new Dictionary<string,object>{{"role",Roles[i]},{"systemId",Ids[i]},
          {"path",Environment.ExpandEnvironmentVariables(key==null?"":Convert.ToString(key.GetValue(Roles[i],"")))}};
        if(cursor!=IntPtr.Zero) {
          Dictionary<string,object> info=Info(cursor); role["width"]=info["width"];role["height"]=info["height"];role["hotspot"]=info["hotspot"];
          // Theme paths preserve animations; capture only roles with no configured asset.
          if(String.IsNullOrEmpty((string)role["path"])) role["capture"]=Capture(cursor,info);
        }
        roles.Add(role);
      }
    }
    return new Dictionary<string,object>{{"available",true},{"roles",roles}};
  }
  static object State() {
    CURSORINFO info=new CURSORINFO(); info.size=Marshal.SizeOf(typeof(CURSORINFO));
    if(!GetCursorInfo(ref info)) throw Failure("GetCursorInfo");
    if(info.flags!=1||info.cursor==IntPtr.Zero) return new Dictionary<string,object>{{"visible",false},{"role",null}};
    List<string> matchingRoles=new List<string>();
    for(int i=0;i<Ids.Length;i++)if(LoadCursor(IntPtr.Zero,new IntPtr(Ids[i]))==info.cursor){
      matchingRoles.Add(Roles[i]);
    }
    string role=matchingRoles.Count==1?matchingRoles[0]:null;
    if(role!=null) {
      int roleIndex=Array.IndexOf(Roles,role);
      if(lastCheckedRole!=Ids[roleIndex]&&installedSignatures.ContainsKey(Ids[roleIndex])&&CursorSignature(Ids[roleIndex])!=installedSignatures[Ids[roleIndex]]) {
        Restore();Emit(new {type="theme-changed"});return new Dictionary<string,object>{{"visible",true},{"role",null}};
      }
      lastCheckedRole=Ids[roleIndex];
    }
    if(role==null)lastCheckedRole=-1;
    Dictionary<string,object> state=Info(info.cursor);state["visible"]=true;state["role"]=role;
    if(matchingRoles.Count>1)state["ambiguousRoles"]=matchingRoles;
    string scalingMode;
    if(role!=null&&installedScalingModes.TryGetValue(Ids[Array.IndexOf(Roles,role)],out scalingMode))state["creationScalingMode"]=scalingMode;
    return state;
  }
  public static void Run(int parentId) {
    int awareness=-1;
    try{SetProcessDpiAwarenessContext(new IntPtr(-4));awareness=GetAwarenessFromDpiAwarenessContext(GetThreadDpiAwarenessContext());}
    catch(EntryPointNotFoundException){SetProcessDPIAware();awareness=1;}
    Thread reader=new Thread(delegate(){ try { string line;while((line=Console.ReadLine())!=null)lock(commands)commands.Enqueue(line); }finally{disconnected=true;} });
    reader.IsBackground=true;reader.Start();string signature=ThemeSignature(),lastState="";int tick=0;
    try {
      Emit(new {type="ready",dpiAwareness=awareness,cursorScalingApi=CursorScalingApiAvailable()});
      while(!disconnected) {
        try { if(Process.GetProcessById(parentId).HasExited)break; }catch(ArgumentException){break;}
        string command=null;lock(commands)if(commands.Count>0)command=commands.Dequeue();
        if(command!=null) {
          Dictionary<string,object> request=json.Deserialize<Dictionary<string,object>>(command);object id=request["requestId"];
          try {
            string op=(string)request["op"];object result=null;
            if(op=="theme")result=Theme();
            else if(op=="probe") {
              bool shared=request.ContainsKey("systemId");
              IntPtr cursor=shared?LoadCursor(IntPtr.Zero,new IntPtr(Convert.ToInt32(request["systemId"]))):
                request.ContainsKey("width")?LoadImage(IntPtr.Zero,(string)request["path"],2,Convert.ToInt32(request["width"]),Convert.ToInt32(request["height"]),0x10):LoadCursorFromFile((string)request["path"]);
              if(cursor==IntPtr.Zero)throw Failure("LoadCursorFromFile");
              try {
                Dictionary<string,object> info=Info(cursor);List<string> images=new List<string>();
                int steps=Math.Max(1,Math.Min(128,Convert.ToInt32(request["steps"])));
                for(uint step=0;step<steps;step++)using(Bitmap image=Draw(cursor,(int)info["width"],(int)info["height"],Color.Black,step))using(MemoryStream stream=new MemoryStream()) {
                  image.Save(stream,ImageFormat.Png);images.Add(Convert.ToBase64String(stream.ToArray()));
                }
                result=new {info=info,images=images};
              } finally {if(!shared)DestroyCursor(cursor);}
            }
            else if(op=="reloadTheme") {
              if(!SystemParametersInfo(0x57,0,IntPtr.Zero,0))throw Failure("SPI_SETCURSORS");
              result=new {reloaded=true};
            }
            else if(op=="install") {
              Restore();
              List<object> details=new List<object>();
              foreach(object entry in (System.Collections.IEnumerable)request["roles"]) {
                Dictionary<string,object> item=(Dictionary<string,object>)entry;
                uint role=Convert.ToUInt32(item["systemId"]);if(Array.IndexOf(Ids,(int)role)<0)throw new Exception("Unknown cursor role");
                // LR_LOADFROMFILE without LR_DEFAULTSIZE selects the padded resource at its
                // exact dimensions. Default loading would rescale both cursor art and hotspot.
                string scalingMode=Convert.ToString(item["creationScalingMode"]);
                uint dpiMode=scalingMode=="none"?1u:scalingMode=="default"?2u:0u;
                if(dpiMode==0)throw new Exception("Unknown cursor DPI scaling mode");
                bool scalingSupported;
                IntPtr cursor=LoadImageWithDpiMode((string)item["path"],Convert.ToInt32(item["expectedWidth"]),Convert.ToInt32(item["expectedHeight"]),dpiMode,out scalingSupported);
                if(cursor==IntPtr.Zero)throw Failure("LoadImage cursor");
                Dictionary<string,object> loaded=Info(cursor);
                if(item.ContainsKey("expectedWidth")&&((int)loaded["width"]!=Convert.ToInt32(item["expectedWidth"])||(int)loaded["height"]!=Convert.ToInt32(item["expectedHeight"]))) {
                  DestroyCursor(cursor);throw new Exception("Native cursor size "+loaded["width"]+"x"+loaded["height"]+" differs from requested "+item["expectedWidth"]+"x"+item["expectedHeight"]+" (role "+role+"); replacement refused");
                }
                Dictionary<string,int> loadedHotspot=(Dictionary<string,int>)loaded["hotspot"];
                if(item.ContainsKey("expectedHotspotX")&&(loadedHotspot["x"]!=Convert.ToInt32(item["expectedHotspotX"])||loadedHotspot["y"]!=Convert.ToInt32(item["expectedHotspotY"]))) {
                  DestroyCursor(cursor);throw new Exception("Native cursor hotspot differs from the source; replacement refused");
                }
                if(!SetSystemCursor(cursor,role)){DestroyCursor(cursor);throw Failure("SetSystemCursor");}
                // SetSystemCursor takes ownership. Never destroy the consumed cursor handle.
                installed=true;
                if(scalingSupported)installedScalingModes[(int)role]=scalingMode;
                installedSignatures[(int)role]=CursorSignature((int)role);
                Dictionary<string,object> detail=Info(LoadCursor(IntPtr.Zero,new IntPtr(role)));
                detail["systemId"]=role;if(scalingSupported)detail["creationScalingMode"]=scalingMode;details.Add(detail);
              }
              result=new {installed=installed,roles=details};lastState="";
            } else if(op=="restore"||op=="stop") {Restore(op=="restore");result=new {restored=true};lastState="";}
            else throw new Exception("Unknown command");
            Emit(new {type="reply",requestId=id,result=result});if(op=="stop")break;
          } catch(Exception error) {try{Restore();}catch(Exception restoreError){Emit(new {type="error",error=restoreError.Message});}Emit(new {type="reply",requestId=id,error=error.Message});}
        }
        if(++tick%45==0) {
          string next=ThemeSignature();if(next!=signature||CopiesChanged()){Restore();signature=next;Emit(new {type="theme-changed"});lastState="";}
        }
        string current=json.Serialize(State());if(current!=lastState){Console.WriteLine("{\"type\":\"state\",\"state\":"+current+"}");Console.Out.Flush();lastState=current;}
        Thread.Sleep(16);
      }
    }catch(Exception error){Emit(new {type="error",error=error.Message});}
    finally{try{Restore();Emit(new {type="restored"});}catch(Exception error){Emit(new {type="error",error=error.Message});}}
  }
}
'@
[CursorHost]::Run($ParentProcessId)
`;
