function execute(script, context){ //Defined here since "with" is blocked in class bodies
	with(context){
		return eval(script)
	}
}

class WebOS {
	terminal = null;
	groups = new Map();
	users = new Map();
	fs = null;
	env = new Map([
		['PWD', '/'],
		['PATH', '.:/bin'],
		['USER', 'root'],
		['HOME', '/root']
	]);
	constructor(terminalElement) {
		this.terminalElement = terminalElement;
		this.terminal = new Terminal({
			cursorBlink: true,
		});
	}
	async init(image){
		let term = this.terminal;
		term.open(this.terminalElement);
		term.writeln('Booting...');
		term.writeln('Loading file system...');
		if(WebOS.FileSystem.IsValidImage(image)){
			term.writeln('Loading file system from image.');
			this.fs = await WebOS.FileSystem.LoadFromImage(image);
			term.writeln('Loaded file system from image.');
		}else if(image === false){
			term.writeln('No file system image detected! Creating...');

			this.fs = new WebOS.FileSystem(this);
		
			term.writeln('Creating root user...');
			let rootGroup = new WebOS.User.Group('root');
			this.groups.set('root', rootGroup);
			let rootUser = new WebOS.User('root');
			this.users.set('root', rootUser);
			rootGroup.users.push(rootUser);

			term.writeln('Creating critical binaries...');
			this.fs.createDirectories('root', 'bin', 'home', 'lib', 'tmp', '/');

			this.fs.createFile('/lib/io.so', '/', `
				textBuffer: terminal._core.buffer,
				print: (...args) => terminal.write(...args.map(e=>e.toString())),
				println: (...args) => terminal.writeln(...args.map(e=>e.toString())),
				printout: (...args) => terminal.write('\\r\\n' + args.map(e=>e.toString())),
				readchar: handler => terminal.onData(handler),
				resolvePath: path => fs.resolvePath(path, env.get('PWD')),
				fs: {
					read: path => fs.get(path, env.get('PWD')),
					exists: path => fs.has(path, env.get('PWD')),
					write: (path, contents, append) => {
						let file = fs.get(path, env.get('PWD'));
						if(!file.entries){
							file.contents = (append ? file.contents : '') + contents;
						}
						
					},
					execute: (path, ...args) => fs.executeFile(path, env.get('PWD'), ...args),
					createDir: (path) => fs.createDirectory(path, env.get('PWD'), env.get('USER')),
					createFile: path => fs.createFile(path, env.get('PWD'), '', env.get('USER')),
					createLink: (target, link) => fs.createLink(link, target, env.get('PWD'), env.get('USER'))
				},
				
			`);

			this.fs.createFile('/bin/echo', '/', `#include io
				let [args, flags] = seperateFlags(arguments);
				args.join(' ');
			`);
			
			this.fs.createFile('/bin/bash', '/', `#include io

			let run = (...commands) => {
				for(let command of commands){
					let commands = command.replaceAll(/\\$(\\w+)/g, match => env[match.slice(1)]).split(' ');

					let paths = env.PATH.split(':'), hasRun = false;
					for(let path of paths){
						if(!hasRun){
						if(fs.exists(path + '/' + commands[0])){
							return fs.execute(path + '/' + commands[0], ...commands.slice(1));
							hasRun = true;
						}else if(path == paths.at(-1)){
							return 'bash: ' + commands[0] + ': command not found';
						}
						}
					}
				}
			}
			let prompt = () => '['+env.USER+' '+(env.PWD.split('/').at(-1)||'/')+']$ ';
			

			if(args[0]){
				let contents = fs.read(args[0]).contents;
				run(...contents);
			}else{
				printout(prompt());

				let command = '';

				readchar((e) => {
					switch (e) {
						case '\\u0003': // Ctrl+C
							print('^C');
							printout(prompt());
							break;
						case '\\r': // Enter
							let out = '', append = false;
							if(command.includes('>>')){
								out = command.split('>>').at(-1);
								append = true;
								command = command.split('>>').slice(0, -1).join('');
							}
							if(command.includes('>')){
								out = command.split('>').at(-1);
								command = command.split('>').slice(0, -1).join('>');
							}
							let output = run(command);
							if(output) fs.exists(out) == 1 ? fs.write(out, output, append) : printout(output);
							printout(prompt());
							command = '';
							break;
						case '\\u007F': // Backspace (DEL)
							// Do not delete the prompt
							if (textBuffer.x > prompt().length) {
								print('\\b \\b');
								if (command.length > 0) {
									command = command.substr(0, command.length - 1);
								}
							}
							break;
						default:
							if ((e >= String.fromCharCode(0x20) && e <= String.fromCharCode(0x7e)) || e >= '\\u00a0') {
								command += e;
								print(e);
							}
					}
				});
			}
			`);

			this.fs.createFile('/bin/ls', '/', `#include io
				let [args, flags] = seperateFlags(arguments);
				let path = args[0] ? resolvePath(args[0]) : env.PWD;
				switch(fs.exists(path)){
					case 2:
						try{
						printout();
						for(let [name, file] of fs.read(path).entries){
							if(!name.startsWith('.') || flags.includes('a') || flags.includes('all')){
								let color = '\x1b[0m';
								if(file.entries instanceof Map) color = '\x1b[34m';
								if((file.contents || '').startsWith('#include')) color = '\x1b[32m';
								print(color + name + ' ');
							}
						};
						print('\x1b[0m');
						}catch(err){printout(err.stack)}
						break;
					case 1:
						printout(fs.read(path).path);
						break;
					default:
						printout('ls: ' + path + ': not a file or directory');
				}
			`);

			this.fs.createFile('/bin/cd', '/', `#include io
				env.PWD = resolvePath(args[0]);
			`);

			this.fs.createFile('/bin/pwd', '/', `#include io
				printout(env.PWD);
			`);

			this.fs.createFile('/bin/mkdir', '/', `#include io
				fs.createDir(args[0]);
			`);

			this.fs.createFile('/bin/touch', '/', `#include io
				fs.createFile(args[0]);
			`);

			this.fs.createFile('/bin/cat', '/', `#include io
				let file = fs.read(args[0]);
				file.entries ? 'cat: ' + file.name+ ': Is a directory' : file.contents;
			`);

			this.fs.createFile('/bin/ln', '/', `#include io
				let [args, flags] = seperateFlags(arguments);

				if(flags.findIndex(e=>e.includes('s')) != -1){
					fs.createLink(args[0], args[1]);
				};
			`);
			
		}else{
			term.writeln('No file system image detected! Loading default image...');
			this.fs = await WebOS.FileSystem.LoadFromImage(WebOS.FileSystem.DefaultIamge);
			term.writeln('Loaded default file system')
		}
		term.writeln('Loaded file system, initalizing.');
		document.addEventListener('keydown', e => {
			try{
			if(e.key == 'S'){
				e.preventDefault();
				let a = document.createElement('a'),
					image = this.fs.toImage(),
					href = URL.createObjectURL(new Blob([image]));
				a.setAttribute('href', href);
				a.setAttribute('download', 'image.webiso');
				//a.setAttribute('style', 'position:fixed;right:0;top:0;color:#fff;');
				//a.textContent = 'download';
				//document.body.append(a);
				a.click();
			}
			}catch(err){alert(err.stack)}
		})

		this.fs.executeFile('/bin/bash');
	}

	static EscapeXML(xml){
		return xml.toString().replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
	}

	static ParseXML(xml){
		let parser = new DOMParser();
		let xom = parser.parseFromString(xml);
	}

	static User = class {
		env = new Map([]);
		constructor(name, os){
			if(name != 'root'){
				os.fs.createDirectory(name, '/home', this);
				this.env.set('PWD', `/home/${name}`);
			}
		}

		static Group = class{
			users = [];
			constructor(name){
				this.name = name;
			}
		}
	}

	static FileSystem = class {
		
		#root = null;
		constructor(os){
			this.os = os;
			this.#root = new WebOS.FileSystemDirectory('', [], null, 700);
			this.#root.parent = this.#root;
		}
		resolvePath(path, wd){

			wd ||= '/', path ||= '';

			if(path[0] == '/') return path;

			let absPath = wd.split('/').slice(+(wd == '/'));

			path.split('/').forEach(segment => {
				switch(segment){
					case '':
					case '.':
						break;
					case '..':
						if(absPath.length > 1) absPath.pop();						
						break;
					default:
						absPath.push(segment);
				}
			});

			return absPath.join('/') || '/';
		}

		get(path, wd){
			let dir = this.#root,
			absPath = this.resolvePath(path, wd),
			segments = absPath.split('/').slice(1);
			if(absPath == '/'){
				return dir;
			}
			for(let i = 0; i < segments.length; i++){
				let segment = segments[i]
				if(!dir.entries.has(segment)) throw new ReferenceError('File or directory does not exist: ' + segments.join('/'));
				if(i == segments.length-1) return dir.entries.get(segment);
				if(dir.entries.get(segment) instanceof WebOS.FileSystemFile) throw new TypeError('Not a directory'); 
				dir = dir.entries.get(segment);
			}
		}

		has(path, wd){
			try{
				let entry = this.get(path, wd);
				return entry.entries ? 2 : 1;
			}catch(err){
				return false;
			}
		}

		createDirectory(path, wd, user){
			let absPath = this.resolvePath(path, wd),
			name = absPath.split('/').at(-1),
			parent = absPath.split('/').slice(0, -1).join('/');
			let dir = new WebOS.FileSystemDirectory(name, [], user);
			dir.parent = this.get(parent);
			dir.parent.entries.set(name, dir);
		}

		createDirectories(...args){
			let user = args.at(-1) instanceof WebOS.User ? args.pop() : null, wd = args.pop();

			for(let path of args){
				this.createDirectory(path, wd, user);
			}
		}

		createFile(path, wd, contents, user){
			let absPath = this.resolvePath(path, wd),
				name = absPath.split('/').at(-1),
				parent = absPath.split('/').slice(0, -1).join('/');
			let file = new WebOS.FileSystemFile(name, contents, user);
			file.parent = this.get(parent);
			file.parent.entries.set(name, file);
		}

		createLink(path, target, wd, user){
			let absPath = this.resolvePath(path, wd),
				name = absPath.split('/').at(-1),
				parent = absPath.split('/').slice(0, -1).join('/');
			let link = new WebOS.FileSystemLink(name, this.get(target), user);
			link.parent = this.get(parent);
			link.parent.entries.set(name, link);
		}

		executeFile(path, wd, ...args){
			let	contents = this.get(this.resolvePath(path, wd)).contents;	
			
			let importedLibraries = contents.split('\n').filter(line => /#include (\w+)/.test(line)).flatMap(line => line.substring(9).split(','));
			let runnableContents = contents.split('\n').filter(line => !/#include (\w+)/.test(line)).join('\n');
			
			let context = {
				env: new Proxy(this.os.env, {get(obj, prop){return obj.get(prop)}, set(obj, prop, value){return obj.set(prop, value)}}),
				args, arguments: args,
				seperateFlags: args => [args.filter(arg => !arg.match(/-(-?)[a-zA-Z]+[=\d]*/)), args.filter(arg => arg.match(/-(-?)[a-zA-Z]+[=\d]*/)).flatMap(arg => arg.startsWith('--') ? arg.slice(2) : arg.slice(1).split())]
			};
			for(let name of importedLibraries){
				let lib = execute(`({${this.get(name + '.so', '/lib').contents}})`, this.os);
				Object.assign(context, lib);
			}
				
			return execute(runnableContents, context);
		}

		toImage(){
			return this.#root.toXML();
		}

		static ParsePermissionString(permString){
			let prefixZeros = (num, length) => '0'.repeat(Math.max(0, length - ('' + num).length)) + num;
			if(/(1|2|4)?[0-7]{3}/.test(permString)){
				let permBits = [...permString].map(octal => '0'.repeat(Math.max(0, 3 - parseInt(octal).toString(2).length)) + parseInt(octal).toString(2)).join('');
				return eval(`0b${permBits}`);
			}
			else if(/([r-][w-][xs-]){3}/.test(permString)){
				
			}
			else if(/[01]/.test(permString) && (permString.length == 9 || permString.length == 12)){
				return eval(`0b${permString}`);
			}
		}

		static IsValidImage(image) {

		}

		static LoadFromImage(image) {

		}

		static DefaultIamge = []

	}

	static FileSystemEntry = class {

		get path(){
			let entry = this, segments = [];
			while(entry.parent != entry && entry.parent){
				segments.unshift(entry.name);
				entry = entry.parent;
			}
			return '/' + segments.join('/');
		}
		constructor(name, owner, permissions){
			this.name = name;
			this.owner = owner;
			this.group = owner?.group;
			this.permissions = permissions;
		}
	}

	static FileSystemFile = class extends WebOS.FileSystemEntry {
		constructor(name, contents = [], owner, permissions){
			super(name, owner, permissions ?? WebOS.FileSystemFile.DefaultPermissions);
			this.contents = contents;
		}

		toXML(){
			return `<file name="${this.name}" permissions="0b${this.permissions.toString(2)}" owner="${this.owner}">${WebOS.EscapeXML(this.contents)}</file>`
		}

		static DefaultPermissions = 0b000110110100 //664, rw-rw-r--
	}

	static FileSystemDirectory = class extends WebOS.FileSystemEntry {
		entries = new Map();
		constructor(name, entries = [], owner, permissions){
			super(name, owner, permissions ?? WebOS.FileSystemDirectory.DefaultPermissions);
			this.entries = new Map(entries);
		}

		toXML(){
			return `<directory name="${this.name}" permissions="0b${this.permissions.toString(2)}" owner="${this.owner}">${[...this.entries.values()].map(entry => '\n\t' + entry.toXML().replaceAll('\n', '\n\t')).join('\n')}</directory>`
		}

		static DefaultPermissions = 0b000111111101 //775, rwxrwxr-x
	}

	static FileSystemLink = class extends WebOS.FileSystemEntry{
		get entries(){
			return this.#target.entries
		}
		set entries(value){
			return this.#target.entries = value;
		}
		get contents(){
			return this.#target.contents
		}
		set contents(value){
			return this.#target.contents = value;
		}
		#target;
		constructor(name, target, owner, permissions){
			super(name, owner, permissions ?? target.permissions);
			this.#target = target;

		}

		toXML(){
			return `<link name="${this.name}" permissions="0b${this.permissions.toString(2)}" owner="${this.owner}">${this.#target.path}</link>`
		}

		static FromXML(xml){
			return new WebOS.FileSystemLink()
		}
	}
}