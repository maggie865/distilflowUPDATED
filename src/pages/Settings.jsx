import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Plus, Trash2, Settings as SettingsIcon, User, Cylinder, FlaskConical } from 'lucide-react';
import { toast } from 'sonner';
import PageHeader from '@/components/shared/PageHeader';

const TANK_PURPOSES = ['maceration_dilution', 'final_product_storage', 'diluted_ethanol', 'ibc', 'spare'];
const TANK_LOCATIONS = ['indoor', 'outdoor'];

const EMPTY_TANK = { name: '', capacity_litres: '', purpose: 'maceration_dilution', location: 'indoor', notes: '' };
const EMPTY_INGREDIENT = { name: '', quantity: '', unit: 'g', notes: '' };
const EMPTY_PACKAGING = { name: '', quantity: 1, unit: 'units', type: 'bottle' };
const EMPTY_SPIRIT_FORM = {
  recipe_type: 'spirit',
  name: '', description: '', base_ethanol_volume: '', base_ethanol_abv: '',
  bottles_per_case: '',
  ingredients: [{ ...EMPTY_INGREDIENT }],
  packaging: [],
  notes: ''
};

export default function Settings() {
  const { user, deleteAccount } = useAuth();
  const [tankForm, setTankForm] = useState(EMPTY_TANK);
  const [recipeForm, setRecipeForm] = useState(EMPTY_SPIRIT_FORM);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const queryClient = useQueryClient();

  const { data: tanks = [], isLoading: loadingTanks } = useQuery({
    queryKey: ['storageTanks'],
    queryFn: () => base44.entities.StorageTank.list('name', 100),
  });

  const { data: recipes = [], isLoading: loadingRecipes } = useQuery({
    queryKey: ['recipes'],
    queryFn: () => base44.entities.Recipe.list('name', 50),
  });

  const { data: rawMaterials = [] } = useQuery({
    queryKey: ['rawMaterials'],
    queryFn: () => base44.entities.RawMaterial.list('name', 500),
  });

  const stockIngredients = [...new Map(
    rawMaterials
      .filter(m => m.type !== 'ethanol' && m.type !== 'water')
      .map(m => [m.name, m])
  ).values()].sort((a, b) => a.name.localeCompare(b.name));

  const addTankMutation = useMutation({
    mutationFn: (data) => base44.entities.StorageTank.create({
      ...data,
      capacity_litres: parseFloat(data.capacity_litres),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['storageTanks'] });
      setTankForm(EMPTY_TANK);
      toast.success('Tank added successfully');
    },
  });

  const deleteTankMutation = useMutation({
    mutationFn: (id) => base44.entities.StorageTank.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['storageTanks'] });
      toast.success('Tank deleted');
    },
  });

  const addRecipeMutation = useMutation({
    mutationFn: (data) => {
      const payload = {
        ...data,
        base_ethanol_volume: parseFloat(data.base_ethanol_volume) || 0,
        base_ethanol_abv: data.base_ethanol_abv ? parseFloat(data.base_ethanol_abv) : undefined,
        bottles_per_case: data.bottles_per_case ? parseInt(data.bottles_per_case) : undefined,
        ingredients: data.ingredients
          .filter(i => i.name.trim())
          .map(i => ({ ...i, quantity: parseFloat(i.quantity) || 0 })),
        packaging: (data.packaging || [])
          .filter(p => p.name.trim())
          .map(p => ({ ...p, quantity: parseFloat(p.quantity) || 0 })),
      };
      return base44.entities.Recipe.create(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recipes'] });
      setRecipeForm(EMPTY_SPIRIT_FORM);
      toast.success('Recipe created');
    },
  });

  const deleteRecipeMutation = useMutation({
    mutationFn: (id) => base44.entities.Recipe.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recipes'] });
      toast.success('Recipe deleted');
    },
  });

  const handleDeleteAccount = async () => {
    try {
      await deleteAccount();
    } catch (error) {
      toast.error('Failed to delete account');
    }
  };

  const handleAddTank = (e) => {
    e.preventDefault();
    if (!tankForm.name || !tankForm.capacity_litres) {
      toast.error('Tank name and capacity are required');
      return;
    }
    addTankMutation.mutate(tankForm);
  };

  const handleAddIngredient = () => {
    setRecipeForm(prev => ({
      ...prev,
      ingredients: [...prev.ingredients, { ...EMPTY_INGREDIENT }]
    }));
  };

  const handleRemoveIngredient = (index) => {
    setRecipeForm(prev => ({
      ...prev,
      ingredients: prev.ingredients.filter((_, i) => i !== index)
    }));
  };

  const handleSetIngredient = (index, field, value) => {
    setRecipeForm(prev => {
      const ingredients = [...prev.ingredients];
      ingredients[index] = { ...ingredients[index], [field]: value };
      return { ...prev, ingredients };
    });
  };

  const handleAddPackaging = () => {
    setRecipeForm(prev => ({
      ...prev,
      packaging: [...(prev.packaging || []), { ...EMPTY_PACKAGING }]
    }));
  };

  const handleRemovePackaging = (index) => {
    setRecipeForm(prev => ({
      ...prev,
      packaging: prev.packaging.filter((_, i) => i !== index)
    }));
  };

  const handleSetPackaging = (index, field, value) => {
    setRecipeForm(prev => {
      const packaging = [...prev.packaging];
      packaging[index] = { ...packaging[index], [field]: value };
      return { ...prev, packaging };
    });
  };

  const handleAddRecipe = (e) => {
    e.preventDefault();
    if (!recipeForm.name) {
      toast.error('Recipe name is required');
      return;
    }
    if (recipeForm.recipe_type === 'spirit' && !recipeForm.base_ethanol_volume) {
      toast.error('Base ethanol volume is required for spirit recipes');
      return;
    }
    addRecipeMutation.mutate(recipeForm);
  };

  return (
    <div className="pb-20 md:pb-0">
      <PageHeader title="Settings" subtitle="Manage account, tanks, and production recipes" />

      <Tabs defaultValue="account" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="account" className="flex items-center gap-2">
            <SettingsIcon className="w-4 h-4" />
            <span className="hidden sm:inline">Account</span>
          </TabsTrigger>
          <TabsTrigger value="tanks" className="flex items-center gap-2">
            <Cylinder className="w-4 h-4" />
            <span className="hidden sm:inline">Tanks</span>
          </TabsTrigger>
          <TabsTrigger value="recipes" className="flex items-center gap-2">
            <FlaskConical className="w-4 h-4" />
            <span className="hidden sm:inline">Recipes</span>
          </TabsTrigger>
        </TabsList>

        {/* Account Tab */}
        <TabsContent value="account" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Account Information</CardTitle>
              <CardDescription>Your user profile details</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className="text-muted-foreground">Name</Label>
                <p className="text-lg font-medium">{user?.full_name}</p>
              </div>
              <div>
                <Label className="text-muted-foreground">Email</Label>
                <p className="text-lg font-medium">{user?.email}</p>
              </div>
              <div>
                <Label className="text-muted-foreground">Role</Label>
                <p className="text-lg font-medium capitalize">{user?.role}</p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-destructive/50">
            <CardHeader>
              <CardTitle className="text-destructive">Danger Zone</CardTitle>
              <CardDescription>Irreversible actions</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">Deleting your account will permanently remove all your data from the system.</p>
              <Button variant="destructive" onClick={() => setShowDeleteDialog(true)}>
                <Trash2 className="w-4 h-4 mr-2" />
                Delete Account
              </Button>
            </CardContent>
          </Card>

          <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Your Account?</AlertDialogTitle>
                <AlertDialogDescription>
                  This action cannot be undone. All your data will be permanently deleted.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="flex items-center gap-2 rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2">
                <Trash2 className="w-4 h-4 text-destructive flex-shrink-0" />
                <p className="text-sm text-destructive font-medium">This will delete your account and all associated data.</p>
              </div>
              <div className="flex gap-3 mt-4">
                <AlertDialogCancel asChild>
                  <Button variant="outline">Cancel</Button>
                </AlertDialogCancel>
                <AlertDialogAction asChild>
                  <Button variant="destructive" onClick={handleDeleteAccount}>Delete Account</Button>
                </AlertDialogAction>
              </div>
            </AlertDialogContent>
          </AlertDialog>
        </TabsContent>

        {/* Tanks Tab */}
        <TabsContent value="tanks" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Add New Tank</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleAddTank} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <Label>Tank Name</Label>
                    <Input
                      value={tankForm.name}
                      onChange={(e) => setTankForm({ ...tankForm, name: e.target.value })}
                      placeholder="e.g. Tank A"
                      required
                    />
                  </div>
                  <div>
                    <Label>Capacity (Litres)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={tankForm.capacity_litres}
                      onChange={(e) => setTankForm({ ...tankForm, capacity_litres: e.target.value })}
                      placeholder="1000"
                      required
                    />
                  </div>
                  <div>
                    <Label>Purpose</Label>
                    <Select value={tankForm.purpose} onValueChange={(val) => setTankForm({ ...tankForm, purpose: val })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TANK_PURPOSES.map(p => (
                          <SelectItem key={p} value={p}>
                            {p.replace(/_/g, ' ').charAt(0).toUpperCase() + p.replace(/_/g, ' ').slice(1)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Location</Label>
                    <Select value={tankForm.location} onValueChange={(val) => setTankForm({ ...tankForm, location: val })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TANK_LOCATIONS.map(l => (
                          <SelectItem key={l} value={l}>
                            {l.charAt(0).toUpperCase() + l.slice(1)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-2">
                    <Label>Notes</Label>
                    <Textarea
                      value={tankForm.notes}
                      onChange={(e) => setTankForm({ ...tankForm, notes: e.target.value })}
                      placeholder="Optional notes"
                    />
                  </div>
                </div>
                <Button type="submit" disabled={addTankMutation.isPending}>
                  <Plus className="w-4 h-4 mr-2" />
                  {addTankMutation.isPending ? 'Adding...' : 'Add Tank'}
                </Button>
              </form>
            </CardContent>
          </Card>

          <div>
            <h3 className="text-lg font-semibold mb-4">Existing Tanks</h3>
            {loadingTanks ? (
              <p className="text-muted-foreground">Loading tanks...</p>
            ) : tanks.length === 0 ? (
              <p className="text-muted-foreground">No tanks yet</p>
            ) : (
              <div className="grid gap-3">
                {tanks.map(tank => (
                  <Card key={tank.id}>
                    <CardContent className="pt-6">
                      <div className="flex items-start justify-between">
                        <div className="space-y-1">
                          <p className="font-semibold">{tank.name}</p>
                          <p className="text-sm text-muted-foreground">{tank.capacity_litres}L • {tank.purpose.replace(/_/g, ' ')}</p>
                          {tank.notes && <p className="text-xs text-muted-foreground mt-2">{tank.notes}</p>}
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => deleteTankMutation.mutate(tank.id)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        {/* Recipes Tab */}
        <TabsContent value="recipes" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Create New Spirit Recipe</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleAddRecipe} className="space-y-4 max-h-[70vh] overflow-y-auto pr-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <Label>Product Name</Label>
                    <Input
                      value={recipeForm.name}
                      onChange={(e) => setRecipeForm({ ...recipeForm, name: e.target.value })}
                      placeholder="e.g. London Dry Gin"
                      required
                    />
                  </div>
                  <div className="col-span-2">
                    <Label>Description</Label>
                    <Input
                      value={recipeForm.description}
                      onChange={(e) => setRecipeForm({ ...recipeForm, description: e.target.value })}
                      placeholder="Brief description"
                    />
                  </div>
                  <div>
                    <Label>Base Ethanol Volume (L)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={recipeForm.base_ethanol_volume}
                      onChange={(e) => setRecipeForm({ ...recipeForm, base_ethanol_volume: e.target.value })}
                      placeholder="100"
                      required
                    />
                  </div>
                  <div>
                    <Label>Ethanol ABV %</Label>
                    <Input
                      type="number"
                      step="0.1"
                      value={recipeForm.base_ethanol_abv}
                      onChange={(e) => setRecipeForm({ ...recipeForm, base_ethanol_abv: e.target.value })}
                      placeholder="96"
                    />
                  </div>
                  <div>
                    <Label>Bottles per Case</Label>
                    <Input
                      type="number"
                      value={recipeForm.bottles_per_case}
                      onChange={(e) => setRecipeForm({ ...recipeForm, bottles_per_case: e.target.value })}
                      placeholder="12"
                    />
                  </div>
                </div>

                <div className="rounded-lg border border-border p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Botanicals</p>
                    <Button type="button" variant="outline" size="sm" onClick={handleAddIngredient}>
                      <Plus className="w-3 h-3 mr-1" />Add
                    </Button>
                  </div>
                  {recipeForm.ingredients.map((ing, i) => (
                    <div key={i} className="grid grid-cols-[1fr_80px_60px_auto] gap-2 items-end">
                      <Select
                        value={ing.name}
                        onValueChange={(val) => {
                          const match = stockIngredients.find(m => m.name === val);
                          handleSetIngredient(i, 'name', val);
                          if (match?.unit) handleSetIngredient(i, 'unit', match.unit);
                        }}
                      >
                        <SelectTrigger className="h-9 text-sm">
                          <SelectValue placeholder="Select ingredient…" />
                        </SelectTrigger>
                        <SelectContent>
                          {stockIngredients.map(m => (
                            <SelectItem key={m.id} value={m.name}>{m.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        type="number"
                        step="0.01"
                        value={ing.quantity}
                        onChange={(e) => handleSetIngredient(i, 'quantity', e.target.value)}
                        placeholder="0"
                      />
                      <Input
                        value={ing.unit}
                        onChange={(e) => handleSetIngredient(i, 'unit', e.target.value)}
                        placeholder="g"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 text-destructive hover:text-destructive"
                        onClick={() => handleRemoveIngredient(i)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>

                <div className="rounded-lg border border-border p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Packaging (per bottle)</p>
                    <Button type="button" variant="outline" size="sm" onClick={handleAddPackaging}>
                      <Plus className="w-3 h-3 mr-1" />Add
                    </Button>
                  </div>
                  {(recipeForm.packaging || []).map((p, i) => (
                    <div key={i} className="grid grid-cols-[1fr_70px_80px_auto] gap-2 items-end">
                      <Input
                        value={p.name}
                        onChange={(e) => handleSetPackaging(i, 'name', e.target.value)}
                        placeholder="e.g. 700ml Bottle"
                      />
                      <Input
                        type="number"
                        step="0.01"
                        value={p.quantity}
                        onChange={(e) => handleSetPackaging(i, 'quantity', e.target.value)}
                        placeholder="1"
                      />
                      <Select value={p.type} onValueChange={(val) => handleSetPackaging(i, 'type', val)}>
                        <SelectTrigger className="h-9 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="bottle">Bottle</SelectItem>
                          <SelectItem value="closure">Closure</SelectItem>
                          <SelectItem value="label">Label</SelectItem>
                          <SelectItem value="carton">Carton</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 text-destructive hover:text-destructive"
                        onClick={() => handleRemovePackaging(i)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>

                <div>
                  <Label>Notes</Label>
                  <Textarea
                    value={recipeForm.notes}
                    onChange={(e) => setRecipeForm({ ...recipeForm, notes: e.target.value })}
                    placeholder="Process notes, tips, etc."
                  />
                </div>

                <Button type="submit" className="w-full" disabled={addRecipeMutation.isPending}>
                  {addRecipeMutation.isPending ? 'Creating...' : 'Create Recipe'}
                </Button>
              </form>
            </CardContent>
          </Card>

          <div>
            <h3 className="text-lg font-semibold mb-4">Existing Recipes</h3>
            {loadingRecipes ? (
              <p className="text-muted-foreground">Loading recipes...</p>
            ) : recipes.length === 0 ? (
              <p className="text-muted-foreground">No recipes yet</p>
            ) : (
              <div className="grid gap-3">
                {recipes.map(recipe => (
                  <Card key={recipe.id}>
                    <CardContent className="pt-6">
                      <div className="flex items-start justify-between">
                        <div className="space-y-1">
                          <p className="font-semibold">{recipe.name}</p>
                          {recipe.description && <p className="text-sm text-muted-foreground">{recipe.description}</p>}
                          <p className="text-xs text-muted-foreground mt-2">{recipe.base_ethanol_volume}L base • {recipe.ingredients?.length || 0} ingredients</p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => deleteRecipeMutation.mutate(recipe.id)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}