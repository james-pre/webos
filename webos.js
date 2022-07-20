class WebOS{
	static #db = null;
	static db = new Promise((resolve, reject) => {
		if(WebOS.#db){
			resolve(WebOS.#db);
		}else{
			let req = indexedDB.open('webos', 1);
			req.onupgradeneeded = () => {
				let db = req.result;
				switch(db.version){
					case 1:
						db.createObjectStore('storage');
				}
			};
			req.onsuccess = () => {
				WebOS.#db = req.result;
				resolve(req.result);
			};
			req.onerror = () => reject(req.error);
		}
		
	});
	static FileSystemEntry = class{
		constructor(name, owner, permissions){
			Object.assign(this, {
				name,
				owner: owner.split(':')[0],
				group: owner.split(':')[1],
				permissions
			});
		}
	}
	static FileSystemFile = class extends WebOS.FileSystemEntry{
		constructor(name, owner, perissions, contents){
			super(name, owner, perissions);
			this.contents = contents;
		}
		append(content){
			this.contents += content;
		}
	}
	static FileSystemDirectroy = class extends WebOS.FileSystemEntry{
		constructor(name, owner, perissions){
			super(name, owner, perissions);
			this.contents = new Map();
		}
		get entries(){
			return [...this.contents.entries()]
		}
		get keys(){
			return [...this.contents.keys()]
		}
	}
	static FileSystem = class{
		static load(){

		}
		static save(){

		}
		static parsePath(path, workingDir){
			return path.split('/');
		}
		async init(){
			this.createDir('/bin');
			return this
		}
		createFile(path, contents){

		}
		createDir(...paths){

		}
		get(path, workingDir){

		}
		#root = new WebOS.FileSystemDirectroy('', 'root:root', {user: [true, true, false], group: [false, false, false], world: [false, false, false]})
		constructor(name, doNotSave){
			this.name = name;
		}
	}
	static User = class{
		constructor(){

		}
	}
	static UserGroup = class{
		constructor(){

		}
	}
	static Screen = class{
		mode = 'tty';
		constructor(canvas, {autoStart = true}){
			if(!(canvas instanceof HTMLCanvasElement)) throw new TypeError('Provided canvas must be a HTML canvas element');
			let rect = canvas.getClientRects()[0];
			canvas.width = rect.width;
			canvas.height = rect.height;
			Object.assign(this, {
				canvas,
				context: canvas.getContext('2d'),
				get width(){return canvas.width},
				get height(){return canvas.height}
			});
			if(autoStart) this.init();
		}
		sizeTo(width, height){
			this.canvas.width = width;
			this.canvas.height = height;
		}
		#timestep = 0;
		#deltaTime = 0;
		#frameCount = 0;
		get deltaTime(){
			return this.#deltaTime;
		}
		get frameCount(){
			return this.#frameCount;
		}
		init(){
			requestAnimationFrame(this.update);
		}
		stop(){
			cancelAnimationFrame(this.update);
		}
		writeLine(text){

		}
		readLine(query){

		}
		textBuffer = [];
		lineOffset = 0;
		update = function(time){
			this.#timestep ??= time;
			this.#deltaTime = time - this.#timestep;
			this.#timestep = time;
			this.#frameCount++;
			
			if(this.mode == 'tty'){
				this.context.font = 'normal 16px monospace';
				this.context.fillStyle = '#000000';
				this.context.fillRect(0, 0, this.width, this.height);
				this.context.fillStyle = '#ffffff';
				this.textBuffer.forEach((text, line) => this.context.fillText(text, 0, this.lineOffset + (1+line)*16))
			}else{

			}

			if(typeof this.onupdate == 'function') this.onupdate(this.frameCount, this.deltaTime);
			requestAnimationFrame(this.update);
		}.bind(this)
		writeLine(text){
			this.textBuffer.push(text);
		}
		write(text){
			this.textBuffer.at(-1) += text;
		}
	}
	constructor(name, canvas, options = {screen: {}}){
		Object.assign(this, {
			name,
			screen: new WebOS.Screen(canvas, options.screen),
			fs: null
		});
	}
	init(){
		this.screen.writeLine('Initalizing...');
		this.screen.writeLine('Checking for disk...');
		WebOS.db.then(db => {
			let tx = db.transaction('storage');
			tx.objectStore('storage').get(this.name).onsuccess = e => {
				if(e.target.result){
					this.screen.writeLine('Loading filesystem from disk...');
					WebOS.FileSystem.load(e.target.result);
				}else{
					this.screen.writeLine('Filesystem not found, creating...');
					this.fs = new WebOS.FileSystem(this.name, true);
					this.fs.init().then(fs => {

					});
				}
			};

		});
	}
}