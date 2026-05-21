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

        // Ir al listado de usuarios administrables
        await page.goto('http://redworld.pro:2052/users.php');
        
        // Buscar al cliente en la barra de búsqueda integrada de la tabla
        await page.fill('input[type="search"]', username);
        await page.waitForTimeout(2000); // Esperar que filtre las filas

        // Ubicar el enlace que lleva al usuario específico
        const editLink = await page.locator(`a:has-text("${username}")`).first();
        if (await editLink.count() === 0) {
            return res.status(404).json({ status: 'error', message: `Usuario '${username}' no encontrado en el panel para renovar.` });
        }
        
        // Extraer el link de edición del atributo href
        const href = await editLink.getAttribute('href'); 
        const userId = href.split('id=')[1];

        // Navegar directo a la sección de edición y extensión usando su ID
        await page.goto(`http://redworld.pro:2052/user_reseller.php?action=edit&id=${userId}`);
        
        // Seleccionar el paquete de renovación correspondiente
        await page.selectOption('#package', packageId);
        
        // Simular el flujo visual para calcular los créditos requeridos
        await page.click('a[href="#review-purchase"]');
        await page.waitForTimeout(3000); 

        // Clic final en renovar/comprar
        await page.click('.purchase');
        
        // Espera optimizada para la redirección de éxito tras renovar
        try {
            await page.waitForURL('**/user_reseller.php?successedit*', { timeout: 15000, waitUntil: 'load' });
        } catch (urlError) {
            console.log("Aviso: Espera de redirección de renovación al límite...");
        }

        res.json({ 
            status: 'success', 
            message: `Usuario ${username} renovado con éxito con el paquete ${packageId}.` 
        });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    } finally {
        await browser.close();
    }
});

// ESCUCHAR EN EL PUERTO 3000 EN TODAS LAS INTERFACES DE RED PARA DOCKER
app.listen(3000, '0.0.0.0', () => console.log('API de Playwright lista en el puerto 3000'));
