

class Process {

	/**
	 * Creates a process for code execution
	 * @param file
	 */
	constructor(file){

	}
}

class ProcFS extends BrowserFS.FileSystem.InMemory{

	constructor(){
		super();
	}

	static Name = 'ProcFS';

	static Create(options, cb) {
		cb(null, new ProcFS());
	}
	
	static CreateAsync(opts){
		return new Promise((resolve, reject) => {
			this.Create(opts, (err, fs) => {
				err ? reject(err) : resolve(fs);
			});
		});
	}

}

 //so we can use "with" in a class body
const _EVAL_WITH_SCOPE = (code, scope) => {
	return eval(`with(scope){${code}}`);
}

class WebOS {

	//#mounts = new Map([]);
	//#last_pid = 0;
	#fs;
	
	constructor(terminal){
		this.terminal = terminal;
	}

	//runs through FS checks and initialization and starts the system
	async init(runInit){
		try{
			this.terminal.writeln('Initializing...');

			//initialize the FS
			this.terminal.writeln('Initializing base file system...');
			this.#fs = await BrowserFS.configureAsync({ fs: 'MountableFileSystem', options: {} });
			this.terminal.writeln('Successfully initialized base file system');

			//mount / (IndexedDB)
			this.terminal.writeln('Mounting /...');
			const idbFS = await BrowserFS.FileSystem.IndexedDB.CreateAsync({ cacheSize: 256, storeName: 'webos_root' });
			const memFS = await BrowserFS.FileSystem.InMemory.CreateAsync();
			const mirror = await BrowserFS.FileSystem.AsyncMirror.CreateAsync({ async: idbFS, sync: memFS })
			this.#fs.mount('/', mirror);
			this.terminal.writeln('Successfully mounted /');

			//mount /proc (ProcFS)
			this.terminal.writeln('Mouting /proc...');
			const procFS = await ProcFS.CreateAsync();
			this.#fs.mount('/proc', procFS);
			this.terminal.writeln('Successfully mounted /proc');

			this.fs = BrowserFS.BFSRequire('fs');
			this.fs.initialize(this.#fs);

			if(runInit){
				if(this.fs.existsSync('/sbin/init')){
					this.run('/sbin/init');
				}else{
					throw '/sbin/init does not exist';
				}
			}
			
		}catch(err){
			this.terminal.writeln('Initialization failed: ' + err);
		}
	}

	async run(path, debug){
		
		try{
			if(!this.fs.existsSync(path)){
				throw 'Not a file or directory'
			}

			const source = this.fs.readFileSync(path, { encoding: 'utf8' }), scope = {};

			for(let match of source.matchAll(/^[\s]*\/\/#(\w+)[ ]?(.*)$/igm)){

				const directive = match[1], value = match[2];

				switch(directive){
					case 'import':
						
						if(/<([^.]+)>/i.test(value)){
							//include a standard library
							
							const library = value.slice(1, -1);
							
							
							//TODO? : Replace with dynamic paths (env?)
							if(!this.fs.existsSync(`/lib/${library}.sjo`)){
								throw `Couldn't include standard library "${library}"`;
							}

							const content = this.fs.readFileSync(`/lib/${library}.sjo`, { encoding: 'utf8' });
	
							Object.assign(scope, _EVAL_WITH_SCOPE(content, this));

	
						}else{
							//include from a file
	
							//get the path of the running file
							const dir = path.split('/').slice(0, -1).join('/');
	
							//TODO? : Replace with dynamic paths (env?)
							if(!this.fs.existsSync(dir + '/' + library)){
								throw `Couldn't include library "${library}" from file`;
							}
	
							const content = this.fs.readFileSync(dir + '/' + library, { encoding: 'utf8' });
							Object.assign(scope, _EVAL_WITH_SCOPE(content, this));
						}
						break;
					default:
						throw `Unspported directive "${directive}"`
				}
			}

			console.log(scope);

			_EVAL_WITH_SCOPE(source, scope);

		}catch(err){
			this.terminal.writeln(`Failed to execute "${path}": ${err.stack}`);
		}
	}

	async install(name){
		try{

			if(!this.fs.getRootFS()){
				throw 'File system not initialized';
			}

			this.terminal.writeln(`Installing "${name}"...`);
			switch(name){
				case 'os-minimal':
					const res = await fetch('images/minimal.xml');
					const content = await res.text();
					await this.mountWebIso('/', content);
					break;
				default:
				throw `Can't install "${name}" because it doesn't exist`;
			}
			this.terminal.writeln(`Installed "${name}"`);

		}catch(err){
			this.terminal.writeln('Installation failed: ' + err);
		}
	}

	async mountWebIso(path, image){
		try{
			if(!this.fs.existsSync(path)){
				throw 'Mount path does not exist';
			}

			//validation
			const match = image.match(/^\#webiso (\w+) (\d+)/i);
			if(!match?.[0]) throw 'Image not valid: ' + JSON.stringify(match);
			const type = match[1];
			if(!WebOS.WebIsoFormats.hasOwnProperty(type)) throw `WebIso format "${type}" not supported`;
			const formatter = this.constructor.WebIsoFormats[type].at(match[2]);
			if(!formatter?.parse) throw `WebIso format "${type}" does not support version ${version}`;
			
			await formatter.parse(path, image.substring(match[0].length + 1), this);

		}catch(err){
			throw `Failed to mount image: ${err?.stack ?? err}`;
		}
	}

	static WebIsoFormats = {
		xml: [
			{
				async parse(mountPath, image, {fs, terminal}){
					const parser = new DOMParser();
					const document = parser.parseFromString(image, 'text/html');

					const errorNode = document.querySelector('parsererror');
					if(errorNode?.textContent){
						throw `Failed to parse: ${errorNode.textContent}`;
					}

					const _PARSE = async (parent, parentPath) => {
						for(let node of parent.children){
							const fs_type = node.getAttribute('fs-type') || node.nodeName.toLowerCase(),
								name = node.getAttribute('name'),
								mode = +node.getAttribute('permssions'),
								uid = +node.getAttribute('owner'),
								gid = +node.getAttribute('group'),
								path = parentPath + (parentPath == '/' ? '' : '/') + name;
								terminal.writeln(`Extracting ${path}...`);
							try{
							switch(fs_type){
								case 'file':
									try{
									fs.writeFileSync(path, node.textContent, { encoding: node.getAttribute('encoding') || 'utf8', mode});
									//fs.chownSync(path, uid, gid);
									terminal.writeln(`Extracted ${path} [${fs_type}]`);
									}catch(e){
										alert(e.stack);
										throw e;
									}
									break;
								case 'link':
									if(!node.textContent){
										throw 'Link does not have destination at ' + path;
									}
									fs.linkSync(path, node.textContent);
									fs.lchownSync(path, uid, gid);
									terminal.writeln(`Extracted ${path} [${fs_type}]`);
									break;
								case 'directory':
									fs.mkdirSync(path, { mode, recursive: true });
									await _PARSE(node, path);
									break;
								default:
									throw `Unsupported fs_type "${fs_type}"`;
							}
							}catch(err){
								throw `Failed to parse: ${err?.stack ?? err} at ${path}`;
							}
						}
					}
					
					await _PARSE(document.querySelector('webiso'), mountPath);
				},
				stringify(path){

				}
			}
		]
	}
}