/* =========================================================
   THREE.JS AMBIENT BACKGROUND
   ========================================================= */
(function initBg(){
  try{
    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const canvas = document.getElementById('bg-canvas');
    if (!canvas) return;
    const renderer = new THREE.WebGLRenderer({ canvas, alpha:true, antialias:true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1, 2));
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, window.innerWidth/window.innerHeight, 0.1, 100);
    camera.position.z = 8;

    function resize(){
      renderer.setSize(window.innerWidth, window.innerHeight);
      camera.aspect = window.innerWidth/window.innerHeight;
      camera.updateProjectionMatrix();
    }
    resize();
    window.addEventListener('resize', resize);

    const count = window.innerWidth < 700 ? 350 : 800;
    function field(spread){
      const pos = new Float32Array(count*3);
      for (let i=0;i<count;i++){
        pos[i*3] = (Math.random()-0.5)*spread;
        pos[i*3+1] = (Math.random()-0.5)*spread;
        pos[i*3+2] = (Math.random()-0.5)*spread;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos,3));
      return geo;
    }
    const starsA = new THREE.Points(field(28), new THREE.PointsMaterial({ color:0xffb347, size:0.05, transparent:true, opacity:0.5 }));
    const starsB = new THREE.Points(field(34), new THREE.PointsMaterial({ color:0xf3e7d3, size:0.025, transparent:true, opacity:0.3 }));
    scene.add(starsA, starsB);

    if (reduceMotion){
      renderer.render(scene, camera);
      return;
    }
    function animate(){
      starsA.rotation.y += 0.0006;
      starsA.rotation.x += 0.0002;
      starsB.rotation.y -= 0.00035;
      renderer.render(scene, camera);
      requestAnimationFrame(animate);
    }
    animate();
  }catch(e){
    console.warn('Background animation unavailable', e);
  }
})();
