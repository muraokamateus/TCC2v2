// Importação de dependências que serão utilizadas no trabalho.
const { Builder, By, until } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const CDP = require('chrome-remote-interface');
const fs = require('fs');
const readline = require('readline');
const { createCanvas, loadImage } = require('canvas');
const { v4: uuidv4 } = require('uuid'); // Adicionado para geração de UUID

//Definição do Scrapper, classe que tem função de obter os dados.
class Scraper {
    constructor() {
        //Os drivers e  o cliente iniciam com valor nulo e ocorre a criação de um array vazio para armazenamento dos dados.
        this.driver = null;
        this.client = null;
        this.dataset = [];
    }

    //Método que inicializa o scrapeper, onde ocorre a abertura do navegador e a conexão com o DevTools Protocol.
    async init(url) {
        //O driver do navegador é configurado e iniciado.
        this.driver = new Builder()
            .forBrowser('chrome')
            .setChromeOptions(new chrome.Options().addArguments('--remote-debugging-port=9222', '--start-maximized'))
            .build();
        // Navega pela URL que foi decidida e espera o carregamento total do corpo da página
        await this.driver.get(url);
        await this.driver.wait(until.elementLocated(By.css('body')), 10000);
        //O Chrome DevTools é conectado
        this.client = await CDP();
    }

//Método para captura do XPath dos elementos através do ObjectId do mesmo.
    async getXPathFromObjectId(objectId) {
        //Uma função que funciona no navegador com intuito de obter informações dos elementos
        const { result } = await this.client.Runtime.callFunctionOn({
            functionDeclaration: `
                function() {
                    let element = this;
                    let path = [];
                    while (element) {
                        let siblings = Array.from(element.parentNode.childNodes);
                        let tagName = element.tagName.toLowerCase();
                        let index = siblings.filter(n => n.tagName && n.tagName.toLowerCase() === tagName).indexOf(element) + 1;
                        path.unshift(\`\${tagName}[\${index}]\`);
                        element = element.parentElement;
                    }
                    return '/' + path.join('/');
                }
            `,
            objectId: objectId
        });
        //Retorna o valor obtido
        return result.value;
    }

    //Método que tem a função de capturar todos os event listeners dos elementos da página e incrementar o dataset.
    async captureAllEventListeners() {
        //Se inicia e acessa o DOM e o DOMDebugger do Chrome DevTools Protocol(CDP)
        const { DOM, DOMDebugger } = this.client;
        //Defini a profundidade da raiz de -1  e também é permitido a penetração em DOMs que estão escondidos
        const { root } = await DOM.getDocument({ depth: -1, pierce: true });

        // Cria-se duas arrays e  a partir  nó raiz do DOM é aplicado um loop que tem função de explorar toda a arvoré  e adicionar os nós filhos as duas arrays, onde todas coletadas
        //são armazenadas em 'allNodes'
        const allNodes = [root];
        const nodeStack = [root];
        while (nodeStack.length) {
            const { nodeId, children } = nodeStack.shift();
            if (children) {
                nodeStack.push(...children);
                allNodes.push(...children);
            }
        }

        //É mapeado todos osnós do DOM onde se cria um array, em que é obtido e filtrados os listener de mouse e teclado para cada nó. 
        //Ao final é utilizado o 'Promise.all' para que todas operações assíncronas sejam garantidas
        const promises = allNodes.map(async ({ nodeId }) => {
            try {
                const { object } = await DOM.resolveNode({ nodeId });
                if (!object) {
                    console.warn(`Nó com nodeId ${nodeId} não foi encontrado. Pulando...`);
                    return;
                }

                const { listeners } = await DOMDebugger.getEventListeners({ objectId: object.objectId });
                const keyboardAndMouseListeners = listeners.filter(listener => 
                    ["keydown", "keyup", "keypress", "click", "mousedown", "mouseup", "mousemove"].includes(listener.type)
                );

                 //Ocorre a tentativa de obter as informações do modelo da box e após 
                let elementInfo = null;
                try {
                    const { model } = await DOM.getBoxModel({ nodeId });
                    const [x1, y1] = model.content.slice(0, 2);
                    const [x2, y2] = model.content.slice(2, 4);
                    elementInfo = {
                        x: x1,
                        y: y1,
                        width: x2 - x1,
                        height: y2 - y1
                    };
                } catch (error) {
                    console.warn(`Não foi possível obter o box model para nodeId ${nodeId}. Incluindo sem dimensões.`);
                }
                //Caso o nó possuir eventListerners de mouse e teclado, será criado um objeto(sendo adicionado ao JSON) com id, nodeID, xpath, informações do elemento e eventListener
                if (keyboardAndMouseListeners.length > 0) {
                    const xpath = await this.getXPathFromObjectId(object.objectId);
                    this.dataset.push({
                        id: `el${uuidv4()}`,  // Gera um identificador alfanumérico único usando UUID.
                        nodeId, xpath, elementInfo, eventListeners: keyboardAndMouseListeners,
                        marked: !!elementInfo  // true se elementInfo existir, false caso contrário
                    });
                }
            } catch (error) {
                console.error('Erro ao buscar event listeners:', error);
            }
        });

        await Promise.all(promises);
    }

//Método que marca os elementos  na screenshoot onde possui um eventListener e mostar o respectivo Xpath em  coluna ao lado.
    async markElementsOnScreenshot(screenshotPath) {
        try {
            const data = await fs.promises.readFile(screenshotPath);
            const img = await loadImage(data);

            const extraWidth = 400; // Ajuste conforme necessário
            const canvas = createCanvas(img.width + extraWidth, img.height);
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);

            const xpathColumnX = img.width + 10;// X-posição inicial da coluna XPath
            let xpathColumnY = 20; // Y-posição inicial da coluna XPath

            const colors = ['green', 'blue', 'red', 'purple', 'orange']; // Adicionado array de cores

            ctx.font = '14px Arial'; // Ajuste o tamanho da fonte conforme necessário

            let markedCount = 0;
            let notMarkedCount = 0;

            this.dataset.forEach((item, index) => { // Adicionado index
                const { elementInfo, xpath } = item; // Alterado 'id' para 'xpath'
                if (elementInfo) {
                    markedCount++;
                    const x = elementInfo.x;
                    const y = elementInfo.y;
                    const width = elementInfo.width;
                    const height = elementInfo.height;

                    // Desenha o retângulo ao redor do elemento
                    ctx.strokeStyle = 'red';
                    ctx.lineWidth = 3;
                    ctx.strokeRect(x, y, width, height);

                    // Desenha o XPath na coluna
                    ctx.fillStyle = 'blue';
                    ctx.fillText(`${xpath}`, xpathColumnX, xpathColumnY); // Alterado `#${id}` para `${xpath}`

                    const colorIndex = index % colors.length; // Calculado índice da cor
                    const lineColor = colors[colorIndex]; // Obtido cor

                    const lineStartX = x + width / 2;
                    const lineStartY = y + height / 2;
                    const lineEndX = xpathColumnX;
                    const lineEndY = xpathColumnY - 10;

                    ctx.beginPath();
                    ctx.moveTo(lineStartX, lineStartY);
                    ctx.lineTo(lineEndX, lineEndY);
                    ctx.strokeStyle = lineColor; // Definido cor da linha
                    ctx.lineWidth = 2;
                    ctx.stroke();

                    xpathColumnY += 30; // Ajuste a posição Y para o próximo XPath
                    item.marked = true;
                } else {
                    notMarkedCount++;
                    item.marked = false;
                }
            });

            //Imprime no console a quantidade de elementos que foram marcados  e  os que não foram
            console.log(`Elementos marcados: ${markedCount}`);
            console.log(`Elementos não marcados: ${notMarkedCount}`);

            const out = fs.createWriteStream(screenshotPath);
            const stream = canvas.createPNGStream();
            stream.pipe(out);
            out.on('finish', () => console.log('Captura de tela salva com elementos marcados.'));
        } catch (error) {
            console.error('Erro ao marcar elementos na captura de tela:', error);
        }
    }

    //Método para salvar no JSON
    async saveToJSON(url) {
        //É criado um timestamp com a data e horas, com formato ISO.
        const timestamp = new Date().toISOString().replace(/[^0-9]/g, '');
        //Objeto criado para armazenar URL da fonte, as informações sobre os eventListeners e quantidade total de elementos marcados e não marcados
        const markedCount = this.dataset.filter(item => item.elementInfo).length;
        const notMarkedCount = this.dataset.length - markedCount;
        const outputData = {
            sourceUrl: url,
            eventListeners: this.dataset,
            stats: {
                markedCount,
                markedCountExplanation: 'Número de elementos que contêm informações de dimensão e, portanto, são marcados na screenshot.',
                notMarkedCount,
                notMarkedCountExplanation: 'Número de elementos que não contêm informações de dimensão e não são marcados na screenshot.'
            }
        };
        //Nome do arquivo é definido utilizando uma strng template que inclui o caminho do diretorio + timestamp
        const filename = `dataset/accessibility_data_${timestamp}.json`;
        //É utilizado para escreves os dadosos no arquivo.
        fs.writeFileSync(filename, JSON.stringify(outputData, null, 4));
        return filename;
    }

    //Fecha as conexões e o navegador.
    async close() {
        if (this.client) {
            this.client.close();
        }
        if (this.driver) {
            await this.driver.quit();
        }
    }
}

//Pede uma entrada de dados do usuário através de linha de comando,  onde é ocorre o pedido de informações ao usuario
//e ocorre o fechamento da interface após receber a resposta.
async function promptUser(query) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise(resolve => rl.question(query, (ans) => {
        rl.close();
        resolve(ans);
    }));
}

//Função assíncrona é executado quunado o script for carrgado, onde é solcitado a URL desejada,
//após um scraper executa  várias operações: capturar eventListeners, salvamento dos dado.
//Além disto o erro é registrado  no console  e ao final o scrapper é finalizado e libera os recursos.
//Dentro do mesmo é calculado o tempo de execução do script
(async function() {
    const startTime = process.hrtime();
    const url = await promptUser('Por favor, insira a URL do site: ');

    const scraper = new Scraper();
    await scraper.init(url);

    try {
        await scraper.captureAllEventListeners();
        const jsonFilename = await scraper.saveToJSON(url);
        const screenshotFilename = jsonFilename.replace('.json', '.png');
        await scraper.driver.takeScreenshot().then(data => fs.writeFileSync(screenshotFilename, data, 'base64'));
        await scraper.markElementsOnScreenshot(screenshotFilename);
        console.log(`Dados de acessibilidade e captura de tela salvos para ${url}.`);
    } catch (error) {
        console.error('Erro:', error);
    } finally {
        await scraper.close();
        const elapsedTime = process.hrtime(startTime);
        console.log(`Tempo total de execução: ${elapsedTime[0]}s ${elapsedTime[1] / 1e6}ms`);
    }
})();
