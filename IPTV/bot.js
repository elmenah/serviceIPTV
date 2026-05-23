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

// 1. RUTA PARA CREAR USUARIO (AHORA ENTREGA EXPIRACIÓN Y DÍAS)
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
            
            // Ir al formulario de edición para sacar las credenciales y las fechas
            await page.goto(`http://redworld.pro:2052/user_reseller.php?action=edit&id=${userId}`);
            
            const finalUsername = await page.inputValue('input[name="username"]');
            const finalPassword = await page.inputValue('input[name="password"]');
            
            // Regresar a la tabla de usuarios para buscar las fechas de este usuario creado
            await page.goto('http://redworld.pro:2052/users.php', { waitUntil: 'load' });
            await page.fill('#user_search', finalUsername);
            await page.waitForTimeout(2000);

            // Extraer fecha y días desde las columnas de la tabla filtrada
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

// 2. RUTA PARA RENOVAR/EXTENDER UN USUARIO (CON CAPTURA DE PANTALLA EN ERROR)
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
        
        const searchInput = page.locator('#user_search');
        await searchInput.waitFor({ state: 'visible', timeout: 10000 });
        
        await searchInput.click();
        await page.evaluate(() => { document.querySelector('#user_search').value = ''; });
        await searchInput.fill(username);
        await page.waitForTimeout(3000); // Esperar que el panel reaccione

        // Intentar sacar el ID
        const userId = await page.evaluate((uname) => {
            const filas = Array.from(document.querySelectorAll('#datatable-users tbody tr'));
            for (const fila of filas) {
                const columnas = fila.querySelectorAll('td');
                if (columnas.length < 2) continue;
                
                const textoUsuario = columnas[1]?.innerText.replace(/\s+/g, '').toLowerCase();
                const nombreBuscado = uname.replace(/\s+/g, '').toLowerCase();
                
                if (textoUsuario === nombreBuscado) {
                    const link = fila.querySelector('a[href*="id="]');
                    if (link) {
                        const href = link.getAttribute('href');
                        return href.split('id=')[1];
                    }
                }
            }
            return null;
        }, username);

        // SI NO ENCUENTRA EL USUARIO, DISPARAMOS EL ERROR PARA QUE TOME LA FOTO
        if (!userId) {
            throw new Error(`El usuario '${username}' no fue encontrado en la tabla.`);
        }

        // Proceder a la extensión si todo va bien
        await page.goto(`http://redworld.pro:2052/user_reseller.php?action=extend&id=${userId}`);
        await page.waitForLoadState('networkidle');
        await page.selectOption('#package', realPackageId);
        
        await page.click('a[href="#review-purchase"]');
        await page.waitForTimeout(2000); 
        await page.click('.purchase');
        
        await page.waitForURL('**/user_reseller.php?successedit*', { timeout: 15000, waitUntil: 'load' });

        res.json({ status: 'success', message: `Usuario ${username} renovado.` });

    } catch (error) {
        // 📸 ¡EL BOT SE CAYÓ! TOMAMOS CAPTURA DE PANTALLA INMEDIATAMENTE
        console.log(`Error detectado: ${error.message}. Tomando captura de pantalla...`);
        
        let screenshotBuffer = null;
        try {
            // Toma una foto completa de la pantalla del panel en ese milisegundo
            screenshotBuffer = await page.screenshot({ fullPage: true });
        } catch (snapError) {
            console.log("No se pudo tomar la captura:", snapError.message);
        }

        // Devolvemos el error a n8n, pero le adjuntamos la foto en Base64 si existe
        res.status(404).json({ 
            status: 'error', 
            message: error.message,
            screenshot: screenshotBuffer ? screenshotBuffer.toString('base64') : null
        });

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

app.listen(3000, '0.0.0.0', () => console.log('API de Playwright lista en el puerto 3000'));
