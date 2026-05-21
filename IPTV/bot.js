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

            res.json({ 
                status: 'success', 
                message: 'Usuario creado exitosamente',
                data: { id: userId, username: finalUsername, password: finalPassword }
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

// 2. RUTA PARA RENOVAR/EXTENDER UN USUARIO
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
        await page.evaluate(() => {
            document.querySelector('#user_search').value = '';
        });
        await searchInput.fill(username);
        await page.waitForTimeout(3000); 

        const userLink = page.locator(`a[href*="id="]:has-text("${username}")`).first();
        if (await userLink.count() === 0) {
            return res.status(404).json({ status: 'error', message: `El usuario '${username}' no fue encontrado.` });
        }

        const href = await userLink.getAttribute('href'); 
        const userId = href.split('id=')[1];

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

        res.json({ 
            status: 'success', 
            message: `¡Usuario ${username} renovado exitosamente con el paquete ${packageId}!` 
        });

    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    } finally {
        await browser.close();
    }
});

// 3. RUTA PARA OBTENER TODOS LOS CLIENTES USANDO PAGINACIÓN (PÁGINA POR PÁGINA)
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
            // Esperar que la tabla cargue en la página actual
            await page.waitForSelector('#datatable-users tbody tr', { timeout: 10000 });

            // Extraer las filas de la página actual
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

            // Sumar los usuarios encontrados al saco global
            todosLosUsuarios = todosLosUsuarios.concat(usuariosPagina);

            // Verificar si el botón "Siguiente" (#datatable-users_next) está deshabilitado
            const nextButton = page.locator('#datatable-users_next');
            const classAttribute = await nextButton.getAttribute('class').catch(() => '');

            // Si la clase contiene 'disabled', significa que llegamos a la última página
            if (classAttribute.includes('disabled')) {
                tieneSiguiente = false;
            } else {
                // Hacer clic en Siguiente y esperar un momento a que cambien las filas
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
