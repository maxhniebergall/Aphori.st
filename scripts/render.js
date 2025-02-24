import puppeteer from 'puppeteer';

(async () => {
    const browser = await puppeteer.launch({
        headless: false,  // Make browser visible for debugging
        defaultViewport: null,  // Use default viewport
        args: ['--start-maximized']  // Start maximized
    });
    const page = await browser.newPage();

    // Enable request/response interception
    await page.setRequestInterception(true);

    // Track API requests and responses
    page.on('request', request => {
        if (request.url().includes('/api/')) {
            console.log('\nAPI Request:', {
                url: request.url(),
                method: request.method(),
                headers: request.headers(),
            });
        }
        request.continue();
    });

    page.on('response', async response => {
        if (response.url().includes('/api/')) {
            try {
                const responseBody = await response.json();
                console.log('\nAPI Response:', {
                    url: response.url(),
                    status: response.status(),
                    ok: response.ok(),
                    body: responseBody,
                });
            } catch (e) {
                console.log('Could not parse response body:', e);
            }
        }
        if (!response.ok()) {
            console.error(`Failed response (${response.status()}): ${response.url()}`);
        }
    });

    // Capture console logs with types and better formatting
    page.on('console', async msg => {
        const type = msg.type();
        
        // Get all arguments and properly serialize them
        const args = await Promise.all(msg.args().map(async arg => {
            try {
                const val = await arg.jsonValue();
                return val;
            } catch (e) {
                try {
                    const text = await arg.evaluate(obj => {
                        if (obj === null) return 'null';
                        if (obj === undefined) return 'undefined';
                        if (typeof obj === 'function') return obj.toString();
                        if (typeof obj === 'object') {
                            try {
                                return JSON.stringify(obj, (key, value) => {
                                    if (value instanceof Map) {
                                        return {
                                            dataType: 'Map',
                                            value: Array.from(value.entries()),
                                        };
                                    }
                                    return value;
                                }, 2);
                            } catch (e) {
                                return String(obj);
                            }
                        }
                        return String(obj);
                    });
                    return text;
                } catch (e2) {
                    return `[Unable to serialize: ${e2.message}]`;
                }
            }
        }));

        // Format the log based on the message type
        if (msg.text().includes('StoryTreeOperator:')) {
            console.log('\nStoryTreeOperator Log:', ...args);
        } else if (msg.text().includes('VirtualizedStoryList:')) {
            console.log('\nVirtualizedStoryList Log:', ...args);
        } else if (msg.text().includes('Row:')) {
            console.log('\nRow Log:', ...args);
        } else if (msg.text().includes('RowContainer:')) {
            console.log('\nRowContainer Log:', ...args);
        } else {
            console.log(`\nBrowser ${type}:`, ...args);
        }
    });

    // Capture network errors
    page.on('pageerror', err => {
        console.error('Page error:', err.message);
    });

    // Capture response errors
    page.on('response', response => {
        if (!response.ok()) {
            console.error(`Failed response (${response.status()}): ${response.url()}`);
        }
    });

    console.log("Loading website...");
    await page.goto('http://localhost:3000/storyTree/a3ae004a-f84c-4e13-acef-6748d20e53cf', { 
        waitUntil: ['networkidle0', 'domcontentloaded', 'load']
    });

    // First check if #root exists
    try {
        await page.waitForSelector('#root', { timeout: 5000 });
        console.log('Found #root element');
    } catch (error) {
        console.error('Could not find #root element:', error);
        await browser.close();
        return;
    }

    // Then check for the story-tree-content
    try {
        const contentSelector = '.story-tree-content';
        await page.waitForSelector(contentSelector, { timeout: 5000 });
        console.log('Found story-tree-content element');

        // Get all elements in the hierarchy
        const elements = await page.evaluate(() => {
            const result = {
                root: document.querySelector('#root')?.outerHTML,
                rootChildren: document.querySelector('#root > div')?.outerHTML,
                storyTreeContent: document.querySelector('.story-tree-content')?.outerHTML,
                virtualizedList: document.querySelector('.story-list')?.outerHTML
            };
            return result;
        });

        console.log('\nDOM Structure:', JSON.stringify(elements, null, 2));

        // Get React component tree with more details
        const reactTree = await page.evaluate(() => {
            const getReactInstance = (element) => {
                for (const key in element) {
                    if (key.startsWith('__reactFiber$')) {
                        return element[key];
                    }
                }
                return null;
            };

            const content = document.querySelector('.story-tree-content');
            if (!content) return null;

            const instance = getReactInstance(content);
            if (!instance) return 'No React instance found';

            const getComponentName = (fiber) => {
                if (!fiber) return null;
                const type = fiber.type;
                if (typeof type === 'string') return type;
                if (typeof type === 'function') return type.name;
                return null;
            };

            const getProps = (fiber) => {
                if (!fiber || !fiber.memoizedProps) return null;
                const { children, ...props } = fiber.memoizedProps;
                return props;
            };

            const walkFiber = (fiber, depth = 0) => {
                if (!fiber) return null;
                return {
                    component: getComponentName(fiber),
                    props: getProps(fiber),
                    state: fiber.memoizedState,
                    children: fiber.child ? walkFiber(fiber.child, depth + 1) : null,
                    sibling: fiber.sibling ? walkFiber(fiber.sibling, depth) : null
                };
            };

            return walkFiber(instance);
        });

        console.log('\nReact Component Tree:', JSON.stringify(reactTree, null, 2));

    } catch (error) {
        console.error('Error inspecting content:', error);
    }

    // Keep browser open for manual inspection
    console.log('Browser will stay open for 10 seconds for manual inspection...');
    await new Promise(resolve => setTimeout(resolve, 10000));
    await browser.close();
})();
