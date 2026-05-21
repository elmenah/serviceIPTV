const { chromium } = require('playwright');
const express = require('express');
const app = express();
app.use(express.json());

// FUNCIÓN AUXILIAR PARA PASAR EL LOGIN
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

        // Ir a creación
        await page.goto('http://redworld.pro:2052/user_reseller.php');
        await page.fill('#username', username);
        await page.selectOption('#package', packageId);

        // Avanzar a Review y esperar el cálculo del JS
        await page.click('a[href="#review-purchase"]');
        await page.waitForTimeout(3000); 

        // Clic en Purchase
        await page.click('.purchase');
        await page.waitForNavigation({ waitUntil: 'networkidle' });
        
        const currentUrl = page.url();

        if (currentUrl.includes('successedit')) {
            const userId = currentUrl.split('id=')[1];
            
            // Ir directo a la página donde se ven las credenciales finales
            await page.goto(`http://redworld.pro:2052/user_reseller.php?action=edit&id=${userId}`);
            
            const finalUsername = await page.inputValue('input[name="username"]');
            const finalPassword = await page.inputValue('input[name="password"]');

            res.json({ 
                status: 'success', 
                message: 'Usuario creado exitosamente',
                data: { id: userId, username: finalUsername, password: finalPassword }
            });
        } else {
            res.status(400).json({ status: 'error', message: 'El panel rechazó la creación' });
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

        // Ir al panel de administración de usuarios
        await page.goto('http://redworld.pro:2052/users.php');
        
        // Buscar al usuario en la barra de búsqueda del Datatable del panel
        await page.fill('input[type="search"]', username);
        await page.waitForTimeout(1500);

        // Hacer clic en el botón "Edit" o la acción correspondiente de la fila encontrada
        // Nota: Si el botón tiene un enlace directo o requiere abrir una ruta, la simulamos de forma segura buscando el enlace del usuario
        const editLink = await page.locator(`a:has-text("${username}")`).first();
        if (await editLink.count() === 0) {
            return res.status(404).json({ status: 'error', message: `Usuario ${username} no encontrado en el panel` });
        }
        
        // Extraemos el link de edición del usuario
        const href = await editLink.getAttribute('href'); 
        const userId = href.split('id=')[1];

        // Vamos directo al formulario de edición con acción de extender
        await page.goto(`http://redworld.pro:2052/user_reseller.php?action=edit&id=${userId}`);
        
        // Seleccionamos el paquete de renovación
        await page.selectOption('#package', packageId);
        
        // Flujo visual para recalcular créditos
        await page.click('a[href="#review-purchase"]');
        await page.waitForTimeout(3000); 

        // Guardar/Renovar
        await page.click('.purchase');
        await page.waitForNavigation({ waitUntil: 'networkidle' });

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

app.listen(3000, '0.0.0.0', () => console.log('API de Playwright lista en el puerto 3000'));
