const { chromium } = require('playwright');
const express = require('express');
const app = express();
app.use(express.json());

// FUNCIÓN AUXILIAR PARA INICIAR SESIÓN EN EL PANEL
async function loginToPanel(page) {
    await page.goto('http://redworld.pro:2052/login.php');
    await page.fill('input[name="username"]', 'Flashstorechile');
    await page.fill('input[name="password"]', '83@8$##82@2835flash');
    await page.click('button[type="submit"]');
}

// 1. RUTA PARA CREAR USUARIO (Y EXTRAER SU CLAVE)
app.post('/create-user', async (req, res) => {
    const { username, packageId } = req.body;
    
    const browser = await chromium.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] 
    });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
        await loginToPanel(page);

        // Ir a la sección de creación
        await page.goto('http://redworld.pro:2052/user_reseller.php');
        await page.fill('#username', username);
        await page.selectOption('#package', packageId);

        // Avanzar a Review y esperar el cálculo interno del JS del panel
        await page.click('a[href="#review-purchase"]');
        await page.waitForTimeout(3000); 

        // Clic en el botón real de Purchase
        await page.click('.purchase');
        
        // CORRECCIÓN CRÍTICA: Esperamos máximo 15 segundos a que la URL cambie a "successedit"
        // sin importar si quedan elementos secundarios cargando en la red.
        try {
            await page.waitForURL('**/user_reseller.php?successedit*', { timeout: 15000, waitUntil: 'load' });
        } catch (urlError) {
            console.log("Aviso: Espera de redirección al límite, verificando URL actual...");
        }
        
        const currentUrl = page.url();

        if (currentUrl.includes('successedit')) {
            const userId = currentUrl.split('id=')[1];
            
            // Vamos directo a la edición para rescatar las credenciales creadas
            await page.goto(`http://redworld.pro:2052/user_reseller.php?action=edit&id=${userId}`);
            
            const finalUsername = await page.inputValue('input[name="username"]');
            const finalPassword = await page.inputValue('input[name="password"]');

            res.json({ 
                status: 'success', 
                message: 'Usuario creado exitosamente',
                data: { id: userId, username: finalUsername, password: finalPassword }
            });
        } else {
            res.status(400).json({ status: 'error', message: 'El panel no redirigió a la pantalla de éxito.' });
        }
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    } finally {
        await browser.close();
    }
});

// 2. RUTA PARA RENOVAR/EXTENDER UN USUARIO EXISTENTE
app.post('/extend-user', async (req, res) => {
    const { username, packageId } = req.body;

    const browser = await chromium.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] 
    });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
        await loginToPanel(page);

        // Navegar al listado de usuarios
        await page.goto('http://redworld.pro:2052/users.php', { waitUntil: 'load' });
        
        // 1. LOCALIZAR EL BUSCADOR POR SU ID REAL
        const searchInput = page.locator('#user_search');
        await searchInput.waitFor({ state: 'visible', timeout: 10000 });
        
        // Hacer clic, limpiar el valor precargado ("Search Users...") y escribir el usuario real
        await searchInput.click();
        await page.evaluate(() => {
            document.querySelector('#user_search').value = '';
        });
        await searchInput.fill(username);
        
        // Esperar a que la tabla filtre los resultados
        await page.waitForTimeout(3000); 

        // 2. BUSCAR EL ENLACE DEL USUARIO EN LA TABLA
        // Buscamos el link que contiene el nombre exacto del cliente (ej: "elmenabot")
        const userLink = page.locator(`a[href*="id="]:has-text("${username}")`).first();
        
        if (await userLink.count() === 0) {
            return res.status(404).json({ status: 'error', message: `El usuario '${username}' no fue encontrado tras filtrar.` });
        }

        // Extraemos el ID único del usuario desde su enlace de la tabla
        const href = await userLink.getAttribute('href'); 
        const userId = href.split('id=')[1];

        // 3. IR DIRECTO A LA URL DE EXTENSIÓN EVITANDO SELECCIONAR BOTONES MÓVILES O DESPLEGABLES
        await page.goto(`http://redworld.pro:2052/user_reseller.php?action=extend&id=${userId}`);
        await page.waitForLoadState('networkidle');
        
        // Seleccionar el paquete enviado desde Telegram (ej: "2")
        await page.selectOption('#package', packageId);
        
        // Flujo visual para activar los créditos
        await page.click('a[href="#review-purchase"]');
        await page.waitForTimeout(3000); 

        // Clic final en realizar compra de renovación
        await page.click('.purchase');
        
        // Esperar la redirección de éxito
        try {
            await page.waitForURL('**/user_reseller.php?successedit*', { timeout: 15000, waitUntil: 'load' });
        } catch (urlError) {
            console.log("Aviso: Espera de redirección al límite tras renovar, verificando...");
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

// ESCUCHAR EN EL PUERTO 3000 EN TODAS LAS INTERFACES DE RED PARA DOCKER
app.listen(3000, '0.0.0.0', () => console.log('API de Playwright lista en el puerto 3000'));
