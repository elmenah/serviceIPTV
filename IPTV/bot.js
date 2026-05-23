const { chromium } = require('playwright');
const express = require('express');
const app = express();
app.use(express.json());

// DICCIONARIO DE TRADUCCIÓN (Planes CON XXX - 3 Dispositivos)
const mapeoPlanes = {
    '1mes': '2',
    '+1': '2',
    '1': '2',
    '2meses': '31',
    '+2': '31',
    '2': '31',
    '3meses': '6',
    '+3': '6',
    '3': '6',
    '4meses': '32',
    '+4': '32',
    '4': '32',
    '6meses': '10',
    '+6': '10',
    '6': '10',
    '1ano': '14',
    '12meses': '14',
    '+12': '14',
    '12': '14'
};

// FUNCIÓN AUXILIAR PARA INICIAR SESIÓN EN EL PANEL
async function loginToPanel(page) {
    await page.goto('http://redworld.pro:2052/login.php');
    await page.fill('input[name="username"]', 'Flashstorechile');
    await page.fill('input[name="password"]', '83@8$##82@2835flash');
    await page.click('button[type="submit"]');
}

// 1. RUTA PARA CREAR USUARIO
app.post('/create-user', async (req, res) => {
    const { username, packageId } = req.body;
    const realPackageId = mapeoPlanes[packageId] || packageId;

    const browser = await chromium.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] 
    });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
        await loginToPanel(page);
        await page.goto('http://redworld.pro:2052/user_reseller.php');
        await page.fill('#username', username);
        await page.selectOption('#package', realPackageId);

        await page.click('a[href="#review-purchase"]');
        await page.waitForTimeout(3000); 

        await page.click('.purchase');
        
        try {
            await page.waitForURL('**/user_reseller.php?successedit*', { timeout: 20000, waitUntil: 'load' });
        } catch (urlError) {
            console.log("Aviso: Espera de redirección al límite...");
        }
        
        const currentUrl = page.url();

        if (currentUrl.includes('successedit')) {
            const userId = currentUrl.split('id=')[1];
            
            await page.goto(`http://redworld.pro:2052/user_reseller.php?action=edit&id=${userId}`);
            
            const finalUsername = await page.inputValue('input[name="username"]');
            const finalPassword = await page.inputValue('input[name="password"]');
            
            await page.goto('http://redworld.pro:2052/users.php', { waitUntil: 'load' });
            
            // Forzar filtro de distribuidor para acortar la búsqueda
            const resellerSelect = page.locator('select[name*="reseller"], select[id*="reseller"]').first();
            if (await resellerSelect.count() > 0) {
                await resellerSelect.selectOption('Flashstorechile');
                await page.waitForTimeout(1500);
            }

            await page.fill('#user_search', finalUsername);
            await page.waitForTimeout(2000);

            const fechas = await page.evaluate((uname) => {
                const fila = Array.from(document.querySelectorAll('#datatable-users tbody tr')).find(tr => tr.innerText.includes(uname));
                if (!fila) return { expiration: 'No encontrada', daysLeft: 'No encontrado' };
                const columnas = fila.querySelectorAll('td');
                return {
                    expiration: columnas[6]?.innerText.trim() || 'N/A',
                    daysLeft: columnas[7]?.innerText.trim() || 'N/A'
                };
            }, finalUsername);

            res.json({ 
                status: 'success', 
                message: 'Usuario creado exitosamente',
                data: { 
                    id: userId, 
                    username: finalUsername, 
                    password: finalPassword,
                    expiration: fechas.expiration,
                    daysLeft: fechas.daysLeft
                }
            });
        } else {
            const errorText = await page.locator('.alert, .alert-danger, .error').innerText().catch(() => null);
            res.status(400).json({ 
                status: 'error', 
                message: 'El panel no redirigió a éxito.',
                details: errorText || "Usuario duplicado o falta de créditos."
            });
        }
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    } finally {
        await browser.close();
    }
});

// 2. RUTA PARA RENOVAR/EXTENDER UN USUARIO (CORREGIDA CON EXTRACCIÓN ESTRICTA NATIVA)
app.post('/extend-user', async (req, res) => {
    const { username, packageId } = req.body;
    const realPackageId = mapeoPlanes[packageId] || packageId;

    const browser = await chromium.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] 
    });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
        await loginToPanel(page);
        await page.goto('http://redworld.pro:2052/users.php', { waitUntil: 'load' });
        
        // Forzar filtro de distribuidor para que aparezca tu cliente sí o sí
        const resellerSelect = page.locator('select[name*="reseller"], select[id*="reseller"]').first();
        if (await resellerSelect.count() > 0) {
            await resellerSelect.selectOption('Flashstorechile');
            await page.waitForTimeout(2000); 
        }

        const searchInput = page.locator('#user_search');
        await searchInput.waitFor({ state: 'visible', timeout: 10000 });
        
        await searchInput.click();
        await page.evaluate(() => { document.querySelector('#user_search').value = ''; });
        await searchInput.fill(username);
        await page.waitForTimeout(3000); // Esperar que la tabla filtre en pantalla

        // EXTRACCIÓN CON LOGS DE DIAGNÓSTICO
        const userMatch = await page.evaluate((uname) => {
            const filas = Array.from(document.querySelectorAll('#datatable-users tbody tr'));
            
            // Esto se imprimirá en los logs de Easypanel para ver qué pilló el bot
            console.log("=== INICIO DE LECTURA DE TABLA ===");
            console.log("Buscando de forma exacta a:", uname);
            console.log("Total de filas encontradas en pantalla:", filas.length);

            for (const fila of filas) {
                const columnas = fila.querySelectorAll('td');
                if (columnas.length < 2) continue;
                
                const textoUsuario = columnas[1]?.innerText.trim();
                console.log(`Fila analizada -> Usuario en panel: "${textoUsuario}"`);
                
                if (textoUsuario && textoUsuario.toLowerCase() === uname.toLowerCase()) {
                    const link = fila.querySelector('a[href*="id="]');
                    return {
                        href: link ? link.getAttribute('href') : null,
                        usernameReal: textoUsuario
                    };
                }
            }
            console.log("=== FIN DE LECTURA: NO HUBO COINCIDENCIA ===");
            return null;
        }, username);

        if (!userMatch || !userMatch.href) {
            return res.status(404).json({ 
                status: 'error', 
                message: `El usuario '${username}' no fue encontrado de forma exacta en la tabla.` 
            });
        }

        const userId = userMatch.href.split('id=')[1];

        // Ejecutar extensión
        await page.goto(`http://redworld.pro:2052/user_reseller.php?action=extend&id=${userId}`);
        await page.waitForLoadState('networkidle');
        await page.selectOption('#package', realPackageId);
        
        await page.click('a[href="#review-purchase"]');
        await page.waitForTimeout(3000); 

        await page.click('.purchase');
        
        try {
            await page.waitForURL('**/user_reseller.php?successedit*', { timeout: 15000, waitUntil: 'load' });
        } catch (urlError) {
            console.log("Aviso: Espera de redirección al límite tras renovar...");
        }

        // Rescatar las nuevas fechas de la tabla tras renovar
        await page.goto('http://redworld.pro:2052/users.php', { waitUntil: 'load' });
        if (await resellerSelect.count() > 0) {
            await resellerSelect.selectOption('Flashstorechile');
            await page.waitForTimeout(1500);
        }
        await page.fill('#user_search', username);
        await page.waitForTimeout(2000);

        const fechasActualizadas = await page.evaluate((uname) => {
            const filas = Array.from(document.querySelectorAll('#datatable-users tbody tr'));
            for (const fila of filas) {
                const columnas = fila.querySelectorAll('td');
                if (columnas.length < 8) continue;
                if (columnas[1]?.innerText.trim().toLowerCase() === uname.toLowerCase()) {
                    return {
                        expiration: columnas[6]?.innerText.trim() || 'N/A',
                        daysLeft: columnas[7]?.innerText.trim() || 'N/A'
                    };
                }
            }
            return { expiration: 'No encontrada', daysLeft: 'No encontrado' };
        }, username);

        res.json({ 
            status: 'success', 
            message: `¡Usuario ${username} renovado exitosamente con el paquete ${packageId}!`,
            data: {
                username: username,
                expiration: fechasActualizadas.expiration,
                daysLeft: fechasActualizadas.daysLeft
            }
        });

    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    } finally {
        await browser.close();
    }
});

// 3. RUTA PARA OBTENER TODOS LOS CLIENTES USANDO PAGINACIÓN
app.post('/vencimientos', async (req, res) => {
    const browser = await chromium.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] 
    });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
        await loginToPanel(page);
        await page.goto('http://redworld.pro:2052/users.php', { waitUntil: 'load' });
        
        let todosLosUsuarios = [];
        let tieneSiguiente = true;

        while (tieneSiguiente) {
            await page.waitForSelector('#datatable-users tbody tr', { timeout: 10000 });

            const usuariosPagina = await page.evaluate(() => {
                const filas = Array.from(document.querySelectorAll('#datatable-users tbody tr'));
                return filas.map(fila => {
                    const columnas = fila.querySelectorAll('td');
                    if (columnas.length < 8) return null;
                    return {
                        id: columnas[0]?.innerText.trim(),
                        username: columnas[1]?.innerText.trim(),
                        reseller: columnas[3]?.innerText.trim(),
                        status: columnas[4]?.innerText.trim(),
                        expiration: columnas[6]?.innerText.trim(),
                        daysLeft: columnas[7]?.innerText.trim()
                    };
                }).filter(u => u !== null);
            });

            todosLosUsuarios = todosLosUsuarios.concat(usuariosPagina);

            const nextButton = page.locator('#datatable-users_next');
            const classAttribute = await nextButton.getAttribute('class').catch(() => '');

            if (classAttribute.includes('disabled')) {
                tieneSiguiente = false;
            } else {
                await nextButton.click();
                await page.waitForTimeout(2000); 
            }
        }

        res.json({ 
            status: 'success', 
            total_extraidos: todosLosUsuarios.length, 
            data: todosLosUsuarios 
        });

    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    } finally {
        await browser.close();
    }
});

// 4. RUTA PARA CONSULTAR USUARIO (CORREGIDA CON EXTRACCIÓN ESTRICTA NATIVA)
app.post('/check-user', async (req, res) => {
    const { username } = req.body;

    const browser = await chromium.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] 
    });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
        await loginToPanel(page);
        await page.goto('http://redworld.pro:2052/users.php', { waitUntil: 'load' });
        
        const resellerSelect = page.locator('select[name*="reseller"], select[id*="reseller"]').first();
        if (await resellerSelect.count() > 0) {
            await resellerSelect.selectOption('Flashstorechile');
            await page.waitForTimeout(2000); 
        }

        const searchInput = page.locator('#user_search');
        await searchInput.waitFor({ state: 'visible', timeout: 10000 });
        
        await searchInput.click();
        await page.evaluate(() => { document.querySelector('#user_search').value = ''; });
        await searchInput.fill(username);
        await page.waitForTimeout(3000); 

        // Extracción estricta idéntica para evitar falsos positivos
        const usuarioEncontrado = await page.evaluate((uname) => {
            const filas = Array.from(document.querySelectorAll('#datatable-users tbody tr'));
            
            for (const fila of filas) {
                const columnas = fila.querySelectorAll('td');
                if (columnas.length < 8) continue;
                
                const textoUsuario = columnas[1]?.innerText.trim();
                if (textoUsuario && textoUsuario.toLowerCase() === uname.toLowerCase()) {
                    return {
                        exists: true,
                        username: textoUsuario,
                        reseller: columnas[3]?.innerText.trim(),
                        status: columnas[4]?.innerText.trim(),     
                        expiration: columnas[6]?.innerText.trim(), 
                        daysLeft: columnas[7]?.innerText.trim()    
                    };
                }
            }
            return null; 
        }, username);

        if (!usuarioEncontrado) {
            return res.json({ 
                status: 'not_found', 
                exists: false,
                message: `El usuario '${username}' no existe en el panel.` 
            });
        }

        res.json({
            status: 'success',
            exists: true,
            data: usuarioEncontrado
        });

    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    } finally {
        await browser.close();
    }
});

app.listen(3000, '0.0.0.0', () => console.log('API de Playwright lista en el puerto 3000'));
